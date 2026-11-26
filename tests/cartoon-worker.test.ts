import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ adminClient: vi.fn(), aiConfigured: vi.fn(), illustrate: vi.fn(), selectCartoonNews: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/server/core/supabase/server", () => ({ adminClient: dependencies.adminClient }));
vi.mock("../src/server/core/ai", () => ({ aiConfigured: dependencies.aiConfigured, illustrate: dependencies.illustrate }));
vi.mock("../src/server/cartoon-news", () => ({ selectCartoonNews: dependencies.selectCartoonNews }));
import { CARTOON_BUCKET, processDailyCartoon } from "../src/server/cartoons";

const date = "2026-11-25";
const now = new Date(`${date}T13:00:00Z`);
const news = { headline: "공개 뉴스 제목", summary: "확인한 공개 뉴스의 요약", selectionReason: "여러 출처에서 확인한 소식", caption: "만평 해설", imagePrompt: "An editorial illustration", selectedAt: now.toISOString(), sources: [{ title: "출처 기사", url: "https://example.test/news", publishedAt: now.toISOString() }] };
type Row = Record<string, unknown> & { cartoon_date: string; status: string; claim_token: string; image_path: string | null; image_prompt: string | null; attempts: number };
type Options = {
  resumed?: boolean;
  noClaim?: boolean;
  finalWrite?: "lost-response" | "rejected" | "pending";
  stateReadFails?: boolean;
  failureResponseLost?: boolean;
  beforeCheckpoint?: (row: Row) => void;
  beforeFailureWrite?: (row: Row, uploadedPath: string) => void;
};

function fixture(options: Options = {}) {
  const row: Row = { cartoon_date: date, status: "processing", claim_token: "claim-1", image_path: null,
    image_prompt: options.resumed ? "Saved editorial prompt" : null, attempts: 1, stage: "searching", sources: [] };
  const objects = new Set<string>();
  let uploadedPath = "";
  let delayedFinalWrite: (() => boolean) | undefined;
  const remove = vi.fn(async (paths: string[]) => { paths.forEach(path => objects.delete(path)); return { error: null }; });
  const upload = vi.fn(async (path: string) => { uploadedPath = path; objects.add(path); return { error: null }; });
  class Query {
    changes?: Record<string, unknown>;
    filters: Array<[string, unknown]> = [];
    update(changes: Record<string, unknown>) { this.changes = changes; return this; }
    select(_columns: string) { return this; }
    eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
    async maybeSingle() {
      const matches = () => this.filters.every(([key, value]) => row[key] === value);
      const apply = () => { if (!matches()) return false; Object.assign(row, this.changes); return true; };
      if (!this.changes) {
        if (options.stateReadFails) return { data: null, error: new Error("Read unavailable") };
        return { data: matches() ? { ...row } : null, error: null };
      }
      if (this.changes.stage === "drawing") options.beforeCheckpoint?.(row);
      if (this.changes.status === "ready") {
        if (options.finalWrite === "pending") delayedFinalWrite = apply;
        else if (options.finalWrite !== "rejected") {
          if (!apply()) return { data: null, error: null };
        }
        if (options.finalWrite) return { data: null, error: new Error("Write response lost") };
      } else {
        if (this.changes.status === "failed") options.beforeFailureWrite?.(row, uploadedPath);
        if (!apply()) return { data: null, error: null };
        if (this.changes.status === "failed" && options.failureResponseLost) return { data: null, error: new Error("Failure response lost") };
      }
      return { data: { ...row }, error: null };
    }
  }
  const db = {
    rpc: vi.fn(async () => ({ data: options.noClaim ? [] : [{ ...row }], error: null })),
    from: vi.fn((table: string) => { if (table !== "daily_cartoons") throw new Error("Unexpected private table"); return new Query(); }),
    storage: { from: vi.fn(() => ({ upload, remove })) },
  };
  dependencies.adminClient.mockReturnValue(db);
  return { row, db, objects, upload, remove, completeDelayedWrite: () => delayedFinalWrite?.() };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("DAILY_CARTOON_ENABLED", "true");
  dependencies.aiConfigured.mockReturnValue(true);
  dependencies.illustrate.mockResolvedValue(Buffer.from("test PNG bytes"));
  dependencies.selectCartoonNews.mockResolvedValue(news);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("shared cartoon worker and fenced persistence", () => {
  test("an early direct worker call stops before a claim, including explicit reselection", async () => {
    const f = fixture();
    vi.setSystemTime(new Date(now.getTime() - 1));
    expect(await processDailyCartoon(date)).toEqual({ processed: false, status: "not_due" });
    expect(await processDailyCartoon(date, true)).toEqual({ processed: false, status: "not_due" });
    expect(dependencies.adminClient).not.toHaveBeenCalled(); expect(f.db.rpc).not.toHaveBeenCalled();
    expect(dependencies.selectCartoonNews).not.toHaveBeenCalled(); expect(dependencies.illustrate).not.toHaveBeenCalled();
  });

  test("past editions can still be processed before today's opening", async () => {
    const f = fixture();
    vi.setSystemTime(new Date("2026-11-26T00:00:00Z"));
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "ready" });
    expect(f.db.rpc).toHaveBeenCalledWith("claim_daily_cartoon", { p_date: date });
  });

  test("broadcast prominence metadata is preserved at the news checkpoint", async () => {
    const f = fixture();
    const sources = [{ ...news.sources[0], prominence: { kind: "broadcast_running_order", program: "SBS 8뉴스", editionDate: date, rank: 1,
      url: "https://news.sbs.co.kr/news/programMain.do?broad_date=20261125&prog_cd=R1" } }];
    dependencies.selectCartoonNews.mockResolvedValue({ ...news, sources });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "ready" });
    expect(f.row.sources).toEqual(sources);
  });

  test("selects public news, checkpoints it, then stores one image in its token-specific path", async () => {
    const f = fixture();
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "ready" });
    expect(f.db.rpc).toHaveBeenCalledWith("claim_daily_cartoon", { p_date: date });
    expect(dependencies.selectCartoonNews).toHaveBeenCalledWith(date);
    expect(dependencies.illustrate).toHaveBeenCalledWith(news.imagePrompt);
    expect(f.row).toMatchObject({ status: "ready", stage: "drawing", headline: news.headline, sources: news.sources,
      image_prompt: news.imagePrompt, image_path: `${date}/claim-1.png`, retry_after: null });
    expect(f.db.storage.from).toHaveBeenCalledWith(CARTOON_BUCKET);
    expect(f.upload).toHaveBeenCalledWith(`${date}/claim-1.png`, expect.any(Buffer), { contentType: "image/png", upsert: false });
    expect(f.objects.has(f.row.image_path!)).toBe(true);
    expect(f.remove).not.toHaveBeenCalled();
  });

  test("no verifiable news becomes unavailable with a 15-minute retry cooldown and no image charge", async () => {
    const f = fixture(); dependencies.selectCartoonNews.mockResolvedValue(null);
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "unavailable" });
    expect(f.row.status).toBe("unavailable");
    expect(f.row.retry_after).toBe(new Date(now.getTime() + 15 * 60_000).toISOString());
    expect(dependencies.illustrate).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  test("the last unavailable attempt has no further retry deadline", async () => {
    const f = fixture(); f.row.attempts = 3;
    dependencies.selectCartoonNews.mockResolvedValue(null);
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "unavailable" });
    expect(f.row.retry_after).toBeNull();
    expect(f.row.attempts).toBe(3);
    expect(dependencies.illustrate).not.toHaveBeenCalled();
  });

  test("explicit reselection requests opt in at the atomic claim before a fresh search", async () => {
    const f = fixture();
    expect(await processDailyCartoon(date, true)).toEqual({ processed: true, status: "ready" });
    expect(f.db.rpc).toHaveBeenCalledWith("claim_daily_cartoon", { p_date: date, p_retry_unavailable: true });
    expect(dependencies.selectCartoonNews).toHaveBeenCalledWith(date);
  });

  test("resuming a saved prompt does not repeat news selection", async () => {
    const f = fixture({ resumed: true });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "ready" });
    expect(dependencies.selectCartoonNews).not.toHaveBeenCalled();
    expect(dependencies.illustrate).toHaveBeenCalledWith("Saved editorial prompt");
    expect(f.row.image_prompt).toBe("Saved editorial prompt");
  });

  test("a zero-row claim incurs no news, image or storage calls", async () => {
    const f = fixture({ noClaim: true });
    expect(await processDailyCartoon(date)).toEqual({ processed: false });
    expect(dependencies.selectCartoonNews).not.toHaveBeenCalled(); expect(dependencies.illustrate).not.toHaveBeenCalled();
    expect(f.db.storage.from).not.toHaveBeenCalled();
  });

  test("disabled generation does not access the database", async () => {
    vi.stubEnv("DAILY_CARTOON_ENABLED", "false");
    expect(await processDailyCartoon(date)).toEqual({ processed: false, status: "disabled" });
    expect(dependencies.adminClient).not.toHaveBeenCalled();
    expect(dependencies.selectCartoonNews).not.toHaveBeenCalled(); expect(dependencies.illustrate).not.toHaveBeenCalled();
  });

  test("a lost lease at the news checkpoint stops before drawing", async () => {
    const f = fixture({ beforeCheckpoint: row => { row.claim_token = "claim-2"; } });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "superseded" });
    expect(f.row.claim_token).toBe("claim-2"); expect(f.row.image_prompt).toBeNull();
    expect(dependencies.illustrate).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  test("a stale worker cannot publish over a new token and cleans only its own image", async () => {
    const f = fixture({ resumed: true });
    f.objects.add(`${date}/claim-2.png`);
    dependencies.illustrate.mockImplementation(async () => { f.row.claim_token = "claim-2"; f.row.image_path = `${date}/claim-2.png`; return Buffer.from("png"); });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "superseded" });
    expect(f.row.image_path).toBe(`${date}/claim-2.png`);
    expect([...f.objects]).toEqual([`${date}/claim-2.png`]);
    expect(f.remove).toHaveBeenCalledWith([`${date}/claim-1.png`]);
  });

  test("a committed ready row survives a lost success response", async () => {
    const f = fixture({ finalWrite: "lost-response" });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "ready" });
    expect(f.objects.has(f.row.image_path!)).toBe(true); expect(f.remove).not.toHaveBeenCalled();
  });

  test("an unknown database state leaves the uploaded image untouched", async () => {
    const f = fixture({ finalWrite: "lost-response", stateReadFails: true });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "unknown" });
    expect(f.row.status).toBe("ready"); expect(f.objects.has(f.row.image_path!)).toBe(true);
    expect(f.remove).not.toHaveBeenCalled();
  });

  test("a confirmed failure waits 15 minutes and removes its unreferenced upload", async () => {
    const f = fixture({ finalWrite: "rejected" });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "failed" });
    expect(f.row.retry_after).toBe(new Date(now.getTime() + 15 * 60_000).toISOString());
    expect(f.row.image_path).toBeNull(); expect(f.objects.size).toBe(0);
  });

  test("a lost failure response preserves an upload whose database outcome is uncertain", async () => {
    const f = fixture({ finalWrite: "rejected", failureResponseLost: true });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "unknown" });
    expect(f.objects.size).toBe(1); expect(f.remove).not.toHaveBeenCalled();
  });

  test("a completion racing the failure transition is neither overwritten nor deleted", async () => {
    const f = fixture({ finalWrite: "rejected", beforeFailureWrite: (row, path) => { row.status = "ready"; row.image_path = path; } });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "unknown" });
    expect(f.row.status).toBe("ready"); expect(f.objects.has(f.row.image_path!)).toBe(true);
    expect(f.remove).not.toHaveBeenCalled();
  });

  test("a failure cannot overwrite a newer worker's claim", async () => {
    const f = fixture({ finalWrite: "rejected", beforeFailureWrite: row => { row.claim_token = "claim-2"; } });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "unknown" });
    expect(f.row).toMatchObject({ status: "processing", claim_token: "claim-2" });
    expect(f.remove).not.toHaveBeenCalled();
  });

  test("a delayed final update cannot publish an image already removed after failure", async () => {
    const f = fixture({ finalWrite: "pending" });
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "failed" });
    expect(f.completeDelayedWrite()).toBe(false); expect(f.objects.size).toBe(0);
    expect(f.row).toMatchObject({ status: "failed", image_path: null });
  });

  test("provider failures expose only a fixed error and safe log metadata", async () => {
    const f = fixture();
    dependencies.selectCartoonNews.mockRejectedValue(new Error("private-provider-response-and-secret"));
    expect(await processDailyCartoon(date)).toEqual({ processed: true, status: "failed" });
    expect(String(f.row.error_message)).not.toContain("private-provider");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private-provider");
    expect(dependencies.illustrate).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
});
