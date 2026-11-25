import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), adminClient: vi.fn(), aiConfigured: vi.fn(), worker: vi.fn(), after: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("../src/server/request", async original => ({ ...await original<typeof import("../src/server/request")>(), authenticated: mocks.authenticated }));
vi.mock("../src/server/core/supabase/server", () => ({ adminClient: mocks.adminClient }));
vi.mock("../src/server/core/ai", () => ({ aiConfigured: mocks.aiConfigured, illustrate: vi.fn() }));
vi.mock("../src/server/connections", async original => ({ ...await original<typeof import("../src/server/connections")>(), processConnection: mocks.worker }));
import { HttpError } from "../src/server/request";
import { connectionControls, connectionPayload } from "../src/server/connections";
import { connectionsGet, connectionsPost, connectionJob } from "../src/server/connection-handlers";

type Row = Record<string, any>;
const date = "2026-11-16", today = "2026-11-25", origin = "http://localhost:3001";
const now = new Date("2026-11-25T12:00:00Z");
const userId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000003";
const token = "00000000-0000-4000-8000-000000000004";
const secret = "test-connection-cron-secret-32-characters";

function fixture() {
  const rows: Row[] = [], deleted: Row[] = [];
  const input = { entry_snapshot: [{ content: "private diary marker", created_at: "2026-11-16T10:00:00Z" }], artwork_summary: "private summary", artwork_tags: ["private tag"], input_fingerprint: "current-version" };
  class Query {
    filters: Array<[string, unknown]> = [];
    constructor(readonly table: string) {}
    select() { return this; }
    eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
    order() { return this; }
    limit() { return this; }
    result() {
      const source = this.table === "daily_connections" ? rows : this.table === "deleted_connection_attempts" ? deleted : [];
      return { data: source.filter(row => this.filters.every(([key, value]) => row[key] === value)), error: null };
    }
    async maybeSingle() { return { ...this.result(), data: this.result().data[0] ?? null }; }
    then(resolve: any, reject: any) { return Promise.resolve(this.result()).then(resolve, reject); }
  }
  const sign = vi.fn(async () => ({ data: { signedUrl: "https://storage.test/private-image?token=temporary" }, error: null as unknown }));
  const admin = {
    from: vi.fn((table: string) => new Query(table)),
    rpc: vi.fn(async (name: string, params: Row) => {
      expect(name).toBe("current_connection_input"); expect(params.p_user).toBe(userId);
      return { data: input, error: null };
    }),
    storage: { from: vi.fn(() => ({ createSignedUrl: sign })) },
  };
  const profile = { ai_consent_at: "2026-11-01T00:00:00Z" as string | null };
  const rpc = vi.fn(async (_name: string, p: Row) => {
    if (!rows.some(r => r.user_id === userId && r.entry_date === p.p_date)) rows.push({ id: connectionId, user_id: userId, entry_date: p.p_date, status: "queued", stage: "topics", attempts: 1, input_fingerprint: "current-version", topics: [] });
    return { data: connectionId, error: null as Row | null };
  });
  mocks.authenticated.mockResolvedValue({ user: { id: userId }, profile, db: { rpc } });
  mocks.adminClient.mockReturnValue(admin);
  const ready = (overrides: Row = {}) => {
    const row = { id: connectionId, user_id: userId, entry_date: date, status: "ready", stage: "drawing", attempts: 1,
      input_fingerprint: "current-version", image_path: `${userId}/connection-${connectionId}/${token}.png`, topics: ["coding"],
      headline: "공개 뉴스", sources: [], entry_snapshot: input.entry_snapshot, image_prompt: "private provider prompt", claim_token: token, ...overrides };
    rows.push(row); return row;
  };
  return { rows, deleted, input, admin, sign, profile, rpc, ready };
}
let f: ReturnType<typeof fixture>;
let background: Array<() => Promise<void>>;
const get = (day = date) => connectionsGet(new Request(`${origin}/api/connections?date=${day}`));
const post = (payload: unknown = { date, refresh: false, requestId }, from = origin) => connectionsPost(new Request(`${origin}/api/connections`, { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(payload) }));

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("APP_URL", origin); vi.stubEnv("DAILY_CONNECTION_ENABLED", "true"); vi.stubEnv("CRON_SECRET", secret);
  mocks.aiConfigured.mockReturnValue(true); mocks.worker.mockResolvedValue({ processed: false });
  background = []; mocks.after.mockImplementation(task => background.push(task));
  f = fixture();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("private connection API", () => {
  test("unauthenticated calls never touch privileged data or schedule work", async () => {
    mocks.authenticated.mockRejectedValue(new HttpError(401, "로그인이 필요해요."));
    expect((await get()).status).toBe(401); expect((await post()).status).toBe(401);
    expect(mocks.adminClient).not.toHaveBeenCalled(); expect(background).toEqual([]);
  });
  test("cross-origin writes fail before authentication", async () => {
    expect((await post(undefined, "https://foreign.test")).status).toBe(403);
    expect(mocks.authenticated).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  test.each(["2026-02-30", "invalid", "2026-11-26"])("invalid or future date %s is rejected", async day => {
    expect((await get(day)).status).toBe(400);
    expect((await post({ date: day, refresh: false, requestId })).status).toBe(400);
    expect(f.rpc).not.toHaveBeenCalled(); expect(background).toEqual([]);
  });
  test("POST never accepts caller-provided diary, user IDs or unknown fields", async () => {
    for (const extra of [{ userId: "victim" }, { entries: ["untrusted"] }, { topics: ["coding"] }]) {
      expect((await post({ date, requestId, ...extra })).status).toBe(400);
    }
    expect((await post({ date, requestId: "not-a-uuid" })).status).toBe(400);
    expect((await post({ date, requestId, padding: "x".repeat(1500) })).status).toBe(413);
    expect(f.rpc).not.toHaveBeenCalled();
  });
  test("reading an unrequested day never starts AI work", async () => {
    const r = await get(); expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ date, today, hasEntries: true, canRequest: true, connection: null });
    expect(f.rpc).not.toHaveBeenCalled(); expect(background).toEqual([]);
  });
  test("explicit request delegates ownership to the user RPC and only schedules after response", async () => {
    const r = await post(); expect(r.status).toBe(202);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(f.rpc).toHaveBeenCalledWith("request_daily_connection", { p_date: date, p_refresh: false, p_request_id: requestId });
    const payload = await r.json(); expect(payload).not.toHaveProperty("workId");
    expect(payload.connection).toMatchObject({ id: connectionId, status: "queued", attempts: 1 });
    expect(mocks.worker).not.toHaveBeenCalled(); expect(background).toHaveLength(1);
    await background[0](); expect(mocks.worker).toHaveBeenCalledWith(connectionId);
  });
  test("existing queued work resumes on read without another request or generation allowance", async () => {
    f.ready({ status: "queued", stage: "drawing", attempts: 3 });
    const r = await get(); expect(r.status).toBe(200); expect(background).toHaveLength(1);
    expect(f.rpc).not.toHaveBeenCalled(); expect((await r.json()).canRequest).toBe(false);
  });
  test("ready cache is reused, and source changes are reported separately", async () => {
    f.ready({ input_fingerprint: "old-version" });
    const payload = await (await get()).json();
    expect(payload).toMatchObject({ canRequest: false, canRefresh: true, connection: { status: "ready", sourceChanged: true } });
    expect(background).toEqual([]);
    const text = JSON.stringify(payload);
    for (const secretText of ["private diary marker", "private summary", "private tag", "private provider prompt", token, "input_fingerprint"]) expect(text).not.toContain(secretText);
  });
  test("all admin lookups and history are scoped to the authenticated account", async () => {
    f.ready(); f.rows.push({ id: "foreign", user_id: "another-user", entry_date: "2026-01-01", status: "ready" });
    const payload = await (await get()).json(); expect(payload.dates).toEqual([date]);
    expect(f.admin.rpc).toHaveBeenCalledWith("current_connection_input", { p_user: userId, p_date: date });
    expect(JSON.stringify(payload)).not.toContain("foreign");
  });
  test("an out-of-scope storage path is never signed", async () => {
    f.ready({ image_path: `other-user/connection-${connectionId}/${token}.png` });
    const payload = await (await get()).json();
    expect(payload.connection).toMatchObject({ imageUrl: null, imageError: true }); expect(f.sign).not.toHaveBeenCalled();
  });
  test("a signing failure preserves the news and allows an ordinary reload", async () => {
    f.ready(); f.sign.mockResolvedValue({ data: null as any, error: new Error("unavailable") });
    const payload = await (await get()).json();
    expect(payload.connection).toMatchObject({ headline: "공개 뉴스", imageUrl: null, imageError: true }); expect(background).toEqual([]);
  });
  test("consent withdrawal blocks creation and resumption, while completed private results can be read", async () => {
    f.profile.ai_consent_at = null; f.ready();
    expect((await post()).status).toBe(409);
    const payload = await (await get()).json(); expect(payload.consent).toBe(false); expect(payload.canRefresh).toBe(false);
    expect(payload.connection.status).toBe("ready"); expect(background).toEqual([]); expect(f.rpc).not.toHaveBeenCalled();
  });
  test("deleted-day attempts still prevent resetting the generation budget", async () => {
    f.deleted.push({ user_id: userId, entry_date: date, attempts: 3 });
    const payload = await (await get()).json(); expect(payload).toMatchObject({ hasEntries: true, canRequest: false });
  });
  test("RPC business errors are returned without starting a worker", async () => {
    f.rpc.mockResolvedValue({ data: null as any, error: { code: "P0001", message: "조각글을 먼저 남겨 주세요." } });
    const r = await post(); expect(r.status).toBe(409); expect(await r.json()).toEqual({ error: "조각글을 먼저 남겨 주세요." });
    expect(background).toEqual([]);
  });
  test("the worker route requires its secret and never takes a caller-selected account", async () => {
    const request = (authorization?: string) => new Request(`${origin}/api/connection-jobs`, { method: "POST", headers: authorization ? { Authorization: authorization } : {} });
    expect((await connectionJob(request())).status).toBe(401);
    expect(mocks.worker).not.toHaveBeenCalled();
    expect((await connectionJob(request(`Bearer ${secret}`))).status).toBe(200); expect(mocks.worker).toHaveBeenCalledWith();
  });
});

describe("connection request controls", () => {
  const input = { enabled: true, consent: true, hasEntries: true, attempts: 1 };
  test("failure cooldown and cancelled active leases block another request", () => {
    expect(connectionControls({ status: "failed", retry_after: new Date(now.getTime() + 1000).toISOString() }, input, now).canRequest).toBe(false);
    expect(connectionControls({ status: "failed", retry_after: now.toISOString() }, input, now).canRequest).toBe(true);
    expect(connectionControls({ status: "cancelled", claimed_at: now.toISOString() }, input, now).canRequest).toBe(false);
    expect(connectionControls({ status: "cancelled", claimed_at: new Date(now.getTime() - 600_001).toISOString() }, input, now).canRequest).toBe(true);
  });
  test("a final interrupted claim is displayed as failed instead of polling forever", async () => {
    f.ready({ status: "processing", attempts: 3, claimed_at: new Date(now.getTime() - 600_001).toISOString() });
    const { payload, workId } = await connectionPayload(f.admin as any, userId, date, true, now);
    expect(payload.connection!.status).toBe("failed"); expect(payload.canRequest).toBe(false); expect(workId).toBe(connectionId);
  });
});
