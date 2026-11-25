import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ userClient: vi.fn(), adminClient: vi.fn(), configured: vi.fn(), aiConfigured: vi.fn(), enqueue: vi.fn(), worker: vi.fn(), after: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("../src/server/core/supabase/server", () => mocks);
vi.mock("../src/server/core/ai", () => ({ aiConfigured: mocks.aiConfigured, illustrate: vi.fn() }));
vi.mock("../src/server/cartoon-news", () => ({ selectCartoonNews: vi.fn() }));
vi.mock("../src/server/cartoons", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/server/cartoons")>();
  return { ...actual, enqueueCartoon: mocks.enqueue, processDailyCartoon: mocks.worker };
});
import { cartoonCanRequest, cartoonPayload } from "../src/server/cartoons";
import { cartoonJob, cartoonsGet, cartoonsPost } from "../src/server/cartoon-handlers";

const date = "2026-11-25", origin = "http://127.0.0.1:3001";
const now = new Date(`${date}T10:00:00Z`); // 19:00 KST
const cronSecret = "test-only-cron-secret-at-least-32-characters";
type Row = Record<string, any>;
function fixture() {
  let row: Row | null = null;
  const profile = { id: "test-user", deleting_at: null as string | null };
  const user = { id: "test-user" };
  const tables: string[] = [];
  class Query {
    filters: Array<[string, unknown]> = [];
    select(_columns: string) { return this; }
    eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
    order() { return this; }
    limit() { return this; }
    result() { return { data: row && this.filters.every(([k, v]) => row![k] === v) ? [{ ...row }] : [], error: null }; }
    async maybeSingle() { return { data: this.result().data[0] ?? null, error: null }; }
    then(resolve: any, reject: any) { return Promise.resolve(this.result()).then(resolve, reject); }
  }
  const sign = vi.fn(async () => ({ data: { signedUrl: "https://storage.invalid/cartoon.png?token=signed-image" }, error: null as unknown }));
  const admin = { from: vi.fn((table: string) => { tables.push(table); if (table !== "daily_cartoons") throw new Error("Private journal access is forbidden"); return new Query(); }), storage: { from: vi.fn(() => ({ createSignedUrl: sign })) } };
  const getUser = vi.fn(async () => ({ data: { user: user as typeof user | null }, error: null }));
  const client = { auth: { getUser }, from: vi.fn((table: string) => {
    if (table !== "profiles") throw new Error("Unexpected user data read");
    return { select: () => ({ eq: () => ({ single: async () => ({ data: { ...profile }, error: null }) }) }) };
  }) };
  mocks.userClient.mockResolvedValue(client); mocks.adminClient.mockReturnValue(admin);
  mocks.enqueue.mockImplementation(async (day: string) => { if (!row) row = { cartoon_date: day, status: "queued", stage: "searching", attempts: 0, claimed_at: null, sources: [] }; });
  return { admin, sign, profile, getUser, tables, setRow: (value: Row | null) => { row = value; } };
}
const get = (day?: string) => cartoonsGet(new Request(`${origin}/api/cartoons${day ? `?date=${day}` : ""}`));
const post = (payload: unknown = {}, from = origin) => cartoonsPost(new Request(`${origin}/api/cartoons`, { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
const cron = (authorization?: string) => cartoonJob(new Request(`${origin}/api/cartoon-jobs`, { headers: authorization ? { Authorization: authorization } : {} }));
let f: ReturnType<typeof fixture>;
let background: Array<() => Promise<void>>;

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("APP_URL", origin); vi.stubEnv("DAILY_CARTOON_ENABLED", "true"); vi.stubEnv("CRON_SECRET", cronSecret);
  mocks.configured.mockReturnValue(true); mocks.aiConfigured.mockReturnValue(true);
  mocks.worker.mockResolvedValue({ processed: true, status: "ready" });
  background = []; mocks.after.mockImplementation((task: () => Promise<void>) => { background.push(task); });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  f = fixture();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("cartoon request eligibility", () => {
  test("opens today's edition at 19:00 and allows past but never future editions", () => {
    expect(cartoonCanRequest(null, date, new Date(now.getTime() - 1))).toBe(false);
    expect(cartoonCanRequest(null, date, now)).toBe(true);
    expect(cartoonCanRequest(null, "2026-11-24", now)).toBe(true);
    expect(cartoonCanRequest(null, "2026-11-26", now)).toBe(false);
    expect(cartoonCanRequest(null, date, new Date("2026-11-25T15:00:00Z"))).toBe(true);
    expect(cartoonCanRequest(null, "2026-02-30", now)).toBe(false);
    expect(cartoonCanRequest(null, date, new Date("invalid"))).toBe(false);
  });

  test("respects retry deadlines, ten-minute leases, completed outcomes and the three-attempt cap", () => {
    expect(cartoonCanRequest({ status: "queued", attempts: 0 }, date, now)).toBe(true);
    for (const status of ["queued", "processing", "failed"]) expect(cartoonCanRequest({ status, attempts: 3, claimed_at: "2026-11-25T09:00:00Z", retry_after: "2026-11-25T09:00:00Z" }, date, now)).toBe(false);
    for (const status of ["ready", "unavailable"]) expect(cartoonCanRequest({ status, attempts: 1 }, date, now)).toBe(false);
    expect(cartoonCanRequest({ status: "processing", attempts: 1, claimed_at: new Date(now.getTime() - 10 * 60_000).toISOString() }, date, now)).toBe(false);
    expect(cartoonCanRequest({ status: "processing", attempts: 1, claimed_at: new Date(now.getTime() - 10 * 60_000 - 1).toISOString() }, date, now)).toBe(true);
    expect(cartoonCanRequest({ status: "processing", attempts: 1, claimed_at: null }, date, now)).toBe(false);
    expect(cartoonCanRequest({ status: "failed", attempts: 1, retry_after: new Date(now.getTime() + 15 * 60_000).toISOString() }, date, now)).toBe(false);
    expect(cartoonCanRequest({ status: "failed", attempts: 1, retry_after: now.toISOString() }, date, now)).toBe(true);
    expect(cartoonCanRequest({ status: "failed", attempts: 1, retry_after: null }, date, now)).toBe(false);
    vi.stubEnv("DAILY_CARTOON_ENABLED", "false"); expect(cartoonCanRequest(null, date, now)).toBe(false);
    vi.stubEnv("DAILY_CARTOON_ENABLED", "true"); mocks.aiConfigured.mockReturnValue(false); expect(cartoonCanRequest(null, date, now)).toBe(false);
  });
});

describe("cartoon API boundaries and background scheduling", () => {
  test("GET and POST require an authenticated, non-deleting account", async () => {
    f.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await get()).status).toBe(401); expect((await post()).status).toBe(401);
    expect(mocks.adminClient).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
    f.getUser.mockResolvedValue({ data: { user: { id: "test-user" } }, error: null }); f.profile.deleting_at = now.toISOString();
    expect((await get()).status).toBe(409); expect((await post()).status).toBe(409);
  });

  test("cross-origin POST fails before reading auth or enqueuing", async () => {
    expect((await post({}, "https://another.invalid")).status).toBe(403);
    expect(mocks.userClient).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });

  test("GET rejects invalid/future dates but allows archived editions", async () => {
    for (const day of ["0000-01-01", "2026-02-30", "not-a-date", "2026-11-26"]) expect((await get(day)).status).toBe(400);
    f.setRow({ cartoon_date: "2026-11-24", status: "ready", stage: "drawing", attempts: 1, sources: [] });
    const response = await get("2026-11-24"); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canRequest: false, cartoon: { date: "2026-11-24", status: "ready" } });
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });

  test("POST rejects invalid/future dates and private or unknown fields before enqueueing", async () => {
    for (const payload of [{ date: "0000-01-01" }, { date: "2026-02-30" }, { date: "2026-11-26" }, { date: null }, { date: "" }, { date: date, entries: ["private journal"] }, { userId: "someone" }, null, []]) expect((await post(payload)).status).toBe(400);
    expect((await post({ value: "x".repeat(1001) })).status).toBe(413);
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });

  test("POST before 19:00 KST is a 409 with no job or background work", async () => {
    vi.setSystemTime(new Date(now.getTime() - 1));
    expect((await post()).status).toBe(409);
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });

  test("a past date can start before today's release and keeps its selected date through the worker", async () => {
    vi.setSystemTime(new Date(`${date}T00:00:00Z`));
    const previous = "2026-11-24";
    const response = await post({ date: previous });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ canRequest: true, cartoon: { date: previous, status: "queued" } });
    expect(mocks.enqueue).toHaveBeenCalledWith(previous);
    expect(background).toHaveLength(1);
    await background[0]();
    expect(mocks.worker).toHaveBeenCalledWith(previous);
  });

  test("past ready editions stay unchanged and exhausted past attempts schedule no work", async () => {
    for (const status of ["ready", "unavailable", "failed"]) {
      f.setRow({ cartoon_date: "2026-11-24", status, attempts: 3, sources: [] });
      const response = await post({ date: "2026-11-24" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ canRequest: false, cartoon: { date: "2026-11-24", status } });
    }
    expect(mocks.after).not.toHaveBeenCalled();
  });

  test("POST returns a 202 first and runs the worker only in the after callback", async () => {
    const response = await post();
    expect(response.status).toBe(202); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ today: date, canRequest: true, cartoon: { status: "queued" } });
    expect(mocks.enqueue).toHaveBeenCalledWith(date); expect(background).toHaveLength(1);
    expect(mocks.worker).not.toHaveBeenCalled();
    await background[0](); expect(mocks.worker).toHaveBeenCalledWith(date);
  });

  test.each(["ready", "unavailable"])("POST preserves %s and schedules no regeneration", async status => {
    f.setRow({ cartoon_date: date, status, attempts: 1, sources: [] });
    const response = await post(); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canRequest: false, cartoon: { status } });
    expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
  });

  test("an active lease returns pending without starting another worker", async () => {
    f.setRow({ cartoon_date: date, status: "processing", stage: "drawing", attempts: 1, claimed_at: now.toISOString() });
    const response = await post(); expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ canRequest: false });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  test("background exceptions do not escape after the response", async () => {
    mocks.worker.mockRejectedValue(new Error("private worker detail"));
    expect((await post()).status).toBe(202);
    await expect(background[0]()).resolves.toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private worker detail");
  });

  test("disabled generation rejects POST and cron without enqueueing", async () => {
    vi.stubEnv("DAILY_CARTOON_ENABLED", "false");
    expect((await post()).status).toBe(503); expect((await cron(`Bearer ${cronSecret}`)).status).toBe(503);
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
  });
});

describe("cartoon public DTO", () => {
  test("returns only agreed fields and never reads private journal tables", async () => {
    f.setRow({ cartoon_date: date, status: "ready", stage: "drawing", headline: "뉴스", summary: "공개 요약", selection_reason: "선정 근거", caption: "해설", sources: newsSources(),
      image_path: `${date}/internal-token.png`, image_prompt: "INTERNAL_PROMPT", claim_token: "INTERNAL_CLAIM", claimed_at: now.toISOString(), attempts: 2,
      selected_at: now.toISOString(), completed_at: now.toISOString(), error_message: null, entry_snapshot: "PRIVATE_JOURNAL", user_id: "PRIVATE_USER", created_at: "INTERNAL_CREATED_AT" });
    const response = await get(); expect(response.status).toBe(200); const payload = await response.json();
    expect(Object.keys(payload.cartoon).sort()).toEqual(["date", "status", "stage", "headline", "summary", "selectionReason", "caption", "sources", "imageUrl", "imageError", "selectedAt", "completedAt", "error", "attempts", "maxAttempts"].sort());
    expect(payload.cartoon).toMatchObject({ attempts: 2, maxAttempts: 3 });
    const serialized = JSON.stringify(payload);
    for (const privateValue of ["image_path", "image_prompt", "claim_token", "claimed_at", "entry_snapshot", "user_id", "INTERNAL_PROMPT", "INTERNAL_CLAIM", "PRIVATE_JOURNAL", "PRIVATE_USER", "INTERNAL_CREATED_AT"]) expect(serialized).not.toContain(privateValue);
    expect(f.tables).toEqual(["daily_cartoons", "daily_cartoons"]);
    expect(f.sign).toHaveBeenCalledWith(`${date}/internal-token.png`, 3600);
  });

  test("a signing error is exposed as an image error, not a fake completed image", async () => {
    f.setRow({ cartoon_date: date, status: "ready", image_path: `${date}/image.png`, attempts: 1 });
    f.sign.mockResolvedValue({ data: { signedUrl: "" }, error: new Error("Storage down") });
    const payload = await cartoonPayload(f.admin as never, date, now);
    expect(payload.cartoon).toMatchObject({ status: "ready", imageUrl: null, imageError: true });
  });

  test("image signing is restricted to the requested edition's storage prefix", async () => {
    f.setRow({ cartoon_date: date, status: "ready", image_path: "another-date/private.png", attempts: 1 });
    expect((await cartoonPayload(f.admin as never, date, now)).cartoon).toMatchObject({ imageUrl: null, imageError: true });
    expect(f.sign).not.toHaveBeenCalled();
  });

  test("a stale previous-day job remains resumable within its attempt budget", async () => {
    f.setRow({ cartoon_date: "2026-11-24", status: "processing", attempts: 1, claimed_at: "2026-11-24T10:00:00Z" });
    const payload = await cartoonPayload(f.admin as never, "2026-11-24", now);
    expect(payload).toMatchObject({ canRequest: true, cartoon: { status: "processing" } });
  });

  test("an exhausted stale past job is presented as a terminal failure", async () => {
    f.setRow({ cartoon_date: "2026-11-24", status: "processing", attempts: 3, claimed_at: "2026-11-24T10:00:00Z" });
    const payload = await cartoonPayload(f.admin as never, "2026-11-24", now);
    expect(payload).toMatchObject({ canRequest: false, cartoon: { status: "failed", retryAt: null } });
  });
});
function newsSources() { return [{ title: "확인한 뉴스", url: "https://example.test/news", publishedAt: now.toISOString() }]; }

describe("cartoon cron authorization", () => {
  test("missing, wrong or insufficiently long secrets cannot start work", async () => {
    for (const header of [undefined, "Bearer wrong", `bearer ${cronSecret}`]) expect((await cron(header)).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short"); expect((await cron("Bearer short")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", ""); expect((await cron("Bearer ")).status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.userClient).not.toHaveBeenCalled();
  });

  test("the authorized cron invokes today's worker without a browser session or origin", async () => {
    const response = await cron(`Bearer ${cronSecret}`);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ processed: true, status: "ready" });
    expect(mocks.enqueue).toHaveBeenCalledWith(date); expect(mocks.worker).toHaveBeenCalledWith(date);
    expect(mocks.after).not.toHaveBeenCalled(); expect(mocks.userClient).not.toHaveBeenCalled();
  });

  test("cron worker failures return a fixed retryable error", async () => {
    mocks.worker.mockRejectedValue(new Error("private provider details"));
    const response = await cron(`Bearer ${cronSecret}`); expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private provider");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private provider");
  });
});
