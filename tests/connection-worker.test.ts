import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ adminClient: vi.fn(), aiConfigured: vi.fn(), illustrate: vi.fn(),
  extractConnectionTopics: vi.fn(), selectConnectionNews: vi.fn(), connectionNewsWindow: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/server/core/supabase/server", () => ({ adminClient: dependencies.adminClient }));
vi.mock("../src/server/core/ai", () => ({ aiConfigured: dependencies.aiConfigured, illustrate: dependencies.illustrate }));
vi.mock("../src/server/connection-news", () => ({
  CONNECTION_TOPICS: { transport: { label: "대중교통", query: "대중교통 뉴스" } },
  extractConnectionTopics: dependencies.extractConnectionTopics, selectConnectionNews: dependencies.selectConnectionNews,
  connectionNewsWindow: dependencies.connectionNewsWindow,
}));
import { CONNECTION_BUCKET, processConnection } from "../src/server/connections";

const date = "2020-01-02";
const now = new Date("2026-11-25T12:00:00Z");
const window = { newsFrom: "2019-12-01T15:00:00.000Z", newsTo: "2020-01-02T14:59:59.999Z" };
const userId = "alice";
const id = "connection-id";
const token = "aaa111";
const path = `${userId}/connection-${id}/${token}.png`;
const previousPath = `${userId}/connection-${id}/ccc333.png`;
const newerPath = `${userId}/connection-${id}/bbb222.png`;
const news = { headline: "공개 뉴스 제목", summary: "확인한 공개 뉴스의 요약", connectionReason: "대중교통 주제와 연결된다.",
  caption: "뉴스를 설명하는 삽화", imagePrompt: "A symbolic explanatory illustration", topics: ["transport"], selectedAt: now.toISOString(),
  ...window, sources: [{ title: "출처 기사", url: "https://example.test/news", publishedAt: "2020-01-02T10:00:00Z" }] };
type Row = Record<string, unknown> & { id: string; user_id: string; status: string; stage: string; claim_token: string | null;
  claimed_at: string | null; image_path: string | null; image_prompt: string | null; attempts: number };
type Profile = { id: string; ai_consent_at: string | null; deleting_at: string | null };
type Write = { changes: Record<string, unknown>; filters: Array<[string, unknown]> };
type Options = {
  drawing?: boolean;
  noClaim?: boolean;
  previousImage?: boolean;
  finalWrite?: "lost-response" | "rejected" | "pending";
  checkpointResponseLost?: boolean;
  stateReadFailsAfterFinal?: boolean;
  failureResponseLost?: boolean;
  onClaim?: (row: Row, profile: Profile) => void;
  beforeUpdate?: (row: Row, changes: Record<string, unknown>, profile: Profile) => void;
  afterUpdate?: (row: Row, changes: Record<string, unknown>, profile: Profile) => void;
  afterUpload?: (row: Row, profile: Profile) => void;
};

// Scripted API responses exercise worker ordering and query predicates; SQL tests cover RLS and real leases.
function fixture(options: Options = {}) {
  const row: Row = { id, user_id: userId, entry_date: date, status: "processing", stage: options.drawing ? "drawing" : "topics",
    claim_token: token, claimed_at: now.toISOString(), image_path: options.previousImage ? previousPath : null,
    image_prompt: options.drawing ? "Saved illustration prompt" : null, attempts: 1, topics: [], sources: [],
    selected_at: options.drawing ? now.toISOString() : null, news_from: window.newsFrom, news_to: window.newsTo,
    entry_snapshot: [{ content: "비공개 일기 원문", created_at: `${date}T10:00:00+09:00` }],
    artwork_summary: "비공개 그림 요약", artwork_tags: ["비공개 태그"] };
  const profile: Profile = { id: userId, ai_consent_at: now.toISOString(), deleting_at: null };
  const objects = new Set(options.previousImage ? [previousPath] : []);
  const writes: Write[] = [];
  let finalAttempted = false;
  let delayedFinalWrite: (() => boolean) | undefined;
  const remove = vi.fn(async (paths: string[]) => { paths.forEach(value => objects.delete(value)); return { error: null }; });
  const upload = vi.fn(async (value: string) => { objects.add(value); options.afterUpload?.(row, profile); return { error: null }; });
  class Query {
    changes?: Record<string, unknown>;
    filters: Array<[string, unknown]> = [];
    constructor(private table: string) {}
    update(changes: Record<string, unknown>) { this.changes = changes; return this; }
    select(_columns: string) { return this; }
    eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
    async maybeSingle() {
      if (this.table === "profiles") {
        expect(this.filters).toContainEqual(["id", userId]);
        return { data: { ...profile }, error: null };
      }
      const matches = () => this.filters.every(([key, value]) => row[key] === value);
      const apply = () => { if (!matches()) return false; Object.assign(row, this.changes); return true; };
      if (!this.changes) {
        if (finalAttempted && options.stateReadFailsAfterFinal) return { data: null, error: new Error("Read unavailable") };
        return { data: matches() ? { ...row } : null, error: null };
      }
      writes.push({ changes: { ...this.changes }, filters: [...this.filters] });
      options.beforeUpdate?.(row, this.changes, profile);
      if (this.changes.status === "ready") {
        finalAttempted = true;
        if (options.finalWrite === "pending") delayedFinalWrite = apply;
        else if (options.finalWrite !== "rejected" && !apply()) return { data: null, error: null };
        if (options.finalWrite) return { data: null, error: new Error("Write response lost") };
      } else if (!apply()) return { data: null, error: null };
      if ((this.changes.status === "queued" && options.checkpointResponseLost)
        || (this.changes.status === "failed" && options.failureResponseLost)) return { data: null, error: new Error("Write response lost") };
      const saved = { ...row };
      options.afterUpdate?.(row, this.changes, profile);
      return { data: saved, error: null };
    }
  }
  const db = {
    rpc: vi.fn(async () => {
      const claimed = { ...row };
      options.onClaim?.(row, profile);
      return { data: options.noClaim ? [] : [claimed], error: null };
    }),
    from: vi.fn((table: string) => {
      if (!["daily_connections", "profiles"].includes(table)) throw new Error("Unexpected table");
      return new Query(table);
    }),
    storage: { from: vi.fn(() => ({ upload, remove })) },
  };
  dependencies.adminClient.mockReturnValue(db);
  const cancel = () => { profile.ai_consent_at = null; row.status = "cancelled"; row.claim_token = null; };
  return { row, profile, db, objects, writes, upload, remove, cancel, completeDelayedWrite: () => delayedFinalWrite?.() };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  vi.stubEnv("DAILY_CONNECTION_ENABLED", "true");
  dependencies.aiConfigured.mockReturnValue(true);
  dependencies.illustrate.mockResolvedValue(Buffer.from("test PNG bytes"));
  dependencies.extractConnectionTopics.mockResolvedValue({ topics: ["transport"] });
  dependencies.selectConnectionNews.mockResolvedValue(news);
  dependencies.connectionNewsWindow.mockReturnValue(window);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("connection research and image phases", () => {
  test("research uses the old diary date and clears private input without calling images", async () => {
    const f = fixture();
    const privateSnapshot = f.row.entry_snapshot;
    expect(await processConnection(id)).toEqual({ processed: true, status: "queued" });
    expect(f.db.rpc).toHaveBeenCalledWith("claim_daily_connection", { p_id: id });
    expect(dependencies.extractConnectionTopics).toHaveBeenCalledWith({ entries: privateSnapshot, artworkSummary: "비공개 그림 요약", artworkTags: ["비공개 태그"] });
    expect(dependencies.selectConnectionNews).toHaveBeenCalledWith(["transport"], date, now);
    expect(dependencies.connectionNewsWindow).toHaveBeenCalledWith(date, now);
    expect(f.row).toMatchObject({ status: "queued", stage: "drawing", topics: ["transport"], headline: news.headline, sources: news.sources,
      image_prompt: news.imagePrompt, news_from: window.newsFrom, news_to: window.newsTo,
      claim_token: null, claimed_at: null, entry_snapshot: [], artwork_summary: null, artwork_tags: [] });
    expect(dependencies.illustrate).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
    for (const write of f.writes) expect(write.filters).toEqual(expect.arrayContaining([["id", id], ["user_id", userId], ["claim_token", token], ["status", "processing"]]));
  });

  test("a separately claimed drawing phase reuses the saved news and stores the token-specific image", async () => {
    const f = fixture();
    await processConnection(id);
    f.row.status = "processing"; f.row.claim_token = "bbb222"; f.row.claimed_at = now.toISOString();
    expect(await processConnection(id)).toEqual({ processed: true, status: "ready" });
    expect(dependencies.extractConnectionTopics).toHaveBeenCalledTimes(1);
    expect(dependencies.selectConnectionNews).toHaveBeenCalledTimes(1);
    expect(dependencies.illustrate).toHaveBeenCalledWith(news.imagePrompt);
    expect(f.row).toMatchObject({ status: "ready", image_path: newerPath, entry_snapshot: [], artwork_summary: null, artwork_tags: [] });
    expect(f.db.storage.from).toHaveBeenCalledWith(CONNECTION_BUCKET);
    expect(f.upload).toHaveBeenCalledWith(newerPath, expect.any(Buffer), { contentType: "image/png", upsert: false });
    expect(f.objects.has(newerPath)).toBe(true);
  });

  test("persists only the selected news topic after searching both extracted candidates", async () => {
    const f = fixture();
    dependencies.extractConnectionTopics.mockResolvedValue({ topics: ["transport", "coding"] });
    await processConnection(id);
    expect(dependencies.selectConnectionNews).toHaveBeenCalledWith(["transport", "coding"], date, now);
    expect(f.row.topics).toEqual(["transport"]);
  });

  test("a saved drawing checkpoint never re-extracts or re-searches private input", async () => {
    const f = fixture({ drawing: true });
    expect(await processConnection(id)).toEqual({ processed: true, status: "ready" });
    expect(dependencies.extractConnectionTopics).not.toHaveBeenCalled();
    expect(dependencies.selectConnectionNews).not.toHaveBeenCalled();
    expect(dependencies.illustrate).toHaveBeenCalledWith("Saved illustration prompt");
    expect(f.objects.has(path)).toBe(true);
  });

  test("an old-policy drawing checkpoint researches its saved public topic without private extraction", async () => {
    const f = fixture({ drawing: true });
    Object.assign(f.row, { news_from: "2026-11-18T15:00:00Z", news_to: now.toISOString(), topics: ["transport", "untrusted-private-value"],
      entry_snapshot: [], artwork_summary: null, artwork_tags: [] });
    expect(await processConnection(id)).toEqual({ processed: true, status: "queued" });
    expect(dependencies.extractConnectionTopics).not.toHaveBeenCalled();
    expect(dependencies.selectConnectionNews).toHaveBeenCalledWith(["transport"], date, now);
    expect(dependencies.illustrate).not.toHaveBeenCalled();
    expect(f.row).toMatchObject({ stage: "drawing", news_from: window.newsFrom, news_to: window.newsTo, image_prompt: news.imagePrompt, attempts: 1 });
  });

  test.each([null, "invalid", "2026-11-26T12:00:00Z"])("a checkpoint with invalid selection time %s cannot use its saved image prompt", async selected_at => {
    const f = fixture({ drawing: true });
    Object.assign(f.row, { selected_at, topics: ["transport"] });
    expect(await processConnection(id)).toEqual({ processed: true, status: "queued" });
    expect(dependencies.illustrate).not.toHaveBeenCalled();
    expect(dependencies.extractConnectionTopics).not.toHaveBeenCalled();
    expect(dependencies.selectConnectionNews).toHaveBeenCalledWith(["transport"], date, now);
  });

  test("an old checkpoint with no matching monthly news clears its obsolete article and prompt", async () => {
    const f = fixture({ drawing: true });
    Object.assign(f.row, { news_from: "2026-11-18T15:00:00Z", topics: ["transport"], headline: "Old headline", sources: news.sources });
    dependencies.selectConnectionNews.mockResolvedValue(null);
    expect(await processConnection(id)).toEqual({ processed: true, status: "no_match" });
    expect(f.row).toMatchObject({ headline: null, sources: [], image_prompt: null, image_path: null,
      news_from: window.newsFrom, news_to: window.newsTo });
    expect(dependencies.illustrate).not.toHaveBeenCalled();
  });

  test("a committed research checkpoint survives a lost response without discarding it", async () => {
    const f = fixture({ checkpointResponseLost: true });
    expect(await processConnection(id)).toEqual({ processed: true, status: "queued" });
    expect(f.row).toMatchObject({ status: "queued", stage: "drawing", image_prompt: news.imagePrompt, entry_snapshot: [] });
    expect(dependencies.illustrate).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });

  test.each(["empty-topics", "no-news"])("%s becomes no_match with the diary month window and no image request", async reason => {
    const f = fixture({ previousImage: true });
    if (reason === "empty-topics") dependencies.extractConnectionTopics.mockResolvedValue({ topics: [] });
    else dependencies.selectConnectionNews.mockResolvedValue(null);
    expect(await processConnection(id)).toEqual({ processed: true, status: "no_match" });
    expect(f.row).toMatchObject({ status: "no_match", news_from: window.newsFrom, news_to: window.newsTo,
      claimed_at: null, claim_token: null, entry_snapshot: [], artwork_summary: null, artwork_tags: [], image_path: null });
    if (reason === "empty-topics") expect(dependencies.selectConnectionNews).not.toHaveBeenCalled();
    expect(dependencies.illustrate).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
    expect(f.remove).toHaveBeenCalledWith([previousPath]);
  });

  test("keeps the previous image until the replacement is committed, then cleans it", async () => {
    const f = fixture({ drawing: true, previousImage: true, afterUpdate: (row, changes) => {
      if (changes.status === "ready") { expect(row.image_path).toBe(path); expect(f.objects.has(previousPath)).toBe(true); }
    } });
    dependencies.illustrate.mockImplementation(async () => { expect(f.objects.has(previousPath)).toBe(true); return Buffer.from("png"); });
    expect(await processConnection(id)).toEqual({ processed: true, status: "ready" });
    expect([...f.objects]).toEqual([path]);
    expect(f.remove).toHaveBeenCalledWith([previousPath]);
  });

  test("does not remove an image outside this account and connection prefix", async () => {
    const f = fixture({ drawing: true });
    f.row.image_path = "bob/connection-other/ccc333.png";
    f.objects.add(f.row.image_path);
    await processConnection(id);
    expect(f.objects.has("bob/connection-other/ccc333.png")).toBe(true);
    expect(f.remove).not.toHaveBeenCalled();
  });

  test("an empty claim has no provider or storage effects", async () => {
    const f = fixture({ noClaim: true });
    expect(await processConnection()).toEqual({ processed: false });
    expect(f.db.rpc).toHaveBeenCalledWith("claim_daily_connection", { p_id: null });
    expect(dependencies.extractConnectionTopics).not.toHaveBeenCalled(); expect(dependencies.selectConnectionNews).not.toHaveBeenCalled();
    expect(dependencies.illustrate).not.toHaveBeenCalled(); expect(f.db.storage.from).not.toHaveBeenCalled();
  });

  test("disabled generation never accesses the database", async () => {
    vi.stubEnv("DAILY_CONNECTION_ENABLED", "false");
    expect(await processConnection(id)).toEqual({ processed: false, status: "disabled" });
    expect(dependencies.adminClient).not.toHaveBeenCalled();
  });
});

describe("consent checks and stale worker fencing", () => {
  test.each([false, true])("revocation immediately after claiming blocks the %s drawing phase and releases the cancelled lease", async drawing => {
    const f = fixture({ drawing, onClaim: (row, profile) => { profile.ai_consent_at = null; row.status = "cancelled"; row.claim_token = null; } });
    expect(await processConnection(id)).toEqual({ processed: true, status: "cancelled" });
    expect(f.row.claimed_at).toBeNull();
    expect(dependencies.extractConnectionTopics).not.toHaveBeenCalled(); expect(dependencies.selectConnectionNews).not.toHaveBeenCalled();
    expect(dependencies.illustrate).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
    expect(f.writes[0].filters).toEqual(expect.arrayContaining([["id", id], ["user_id", userId], ["status", "cancelled"], ["claimed_at", now.toISOString()]]));
  });

  test("a deleting profile blocks private extraction before any provider call", async () => {
    const f = fixture(); f.profile.deleting_at = now.toISOString();
    expect(await processConnection(id)).toEqual({ processed: true, status: "cancelled" });
    expect(dependencies.extractConnectionTopics).not.toHaveBeenCalled(); expect(dependencies.illustrate).not.toHaveBeenCalled();
  });

  test("revocation while extracting topics blocks search and releases cancellation", async () => {
    const f = fixture();
    dependencies.extractConnectionTopics.mockImplementation(async () => { f.cancel(); return { topics: ["transport"] }; });
    expect(await processConnection(id)).toEqual({ processed: true, status: "cancelled" });
    expect(f.row.claimed_at).toBeNull();
    expect(dependencies.selectConnectionNews).not.toHaveBeenCalled(); expect(dependencies.illustrate).not.toHaveBeenCalled();
  });

  test("revocation during the topic checkpoint blocks the following paid search", async () => {
    const f = fixture({ afterUpdate: (row, changes, profile) => {
      if (changes.stage === "searching") { profile.ai_consent_at = null; row.status = "cancelled"; row.claim_token = null; }
    } });
    expect(await processConnection(id)).toEqual({ processed: true, status: "cancelled" });
    expect(f.row.claimed_at).toBeNull();
    expect(dependencies.selectConnectionNews).not.toHaveBeenCalled(); expect(dependencies.illustrate).not.toHaveBeenCalled();
  });

  test("revocation during search blocks the drawing checkpoint and erases the lease", async () => {
    const f = fixture();
    dependencies.selectConnectionNews.mockImplementation(async () => { f.cancel(); return news; });
    expect(await processConnection(id)).toEqual({ processed: true, status: "cancelled" });
    expect(f.row.claimed_at).toBeNull(); expect(f.row.image_prompt).toBeNull();
    expect(dependencies.illustrate).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  test("revocation during image generation prevents upload", async () => {
    const f = fixture({ drawing: true });
    dependencies.illustrate.mockImplementation(async () => { f.cancel(); return Buffer.from("png"); });
    expect(await processConnection(id)).toEqual({ processed: true, status: "cancelled" });
    expect(f.upload).not.toHaveBeenCalled(); expect(f.row.claimed_at).toBeNull();
  });

  test("revocation during upload removes only this upload and releases the cancelled lease", async () => {
    const f = fixture({ drawing: true, previousImage: true, afterUpload: (row, profile) => {
      profile.ai_consent_at = null; row.status = "cancelled"; row.claim_token = null;
    } });
    expect(await processConnection(id)).toEqual({ processed: true, status: "superseded" });
    expect(f.row.claimed_at).toBeNull();
    expect([...f.objects]).toEqual([previousPath]);
    expect(f.remove).toHaveBeenCalledWith([path]);
  });

  test("a lease lost at the news checkpoint cannot enqueue a new drawing", async () => {
    const f = fixture({ beforeUpdate: (row, changes) => { if (changes.status === "queued") row.claim_token = "bbb222"; } });
    expect(await processConnection(id)).toEqual({ processed: true, status: "superseded" });
    expect(f.row).toMatchObject({ claim_token: "bbb222", image_prompt: null, status: "processing" });
    expect(dependencies.illustrate).not.toHaveBeenCalled();
  });

  test("a newer worker's image and lease survive the stale worker's post-upload cleanup", async () => {
    const nextClaim = new Date(now.getTime() + 1000).toISOString();
    const f = fixture({ drawing: true, afterUpload: row => {
      row.claim_token = "bbb222"; row.claimed_at = nextClaim; row.image_path = newerPath;
    } });
    f.objects.add(newerPath);
    expect(await processConnection(id)).toEqual({ processed: true, status: "superseded" });
    expect(f.row).toMatchObject({ claim_token: "bbb222", claimed_at: nextClaim, image_path: newerPath, status: "processing" });
    expect([...f.objects]).toEqual([newerPath]);
    expect(f.remove).toHaveBeenCalledWith([path]);
  });

  test("cancellation cleanup never releases another cancelled worker's later lease", async () => {
    const nextClaim = new Date(now.getTime() + 1000).toISOString();
    const f = fixture({ onClaim: (row, profile) => {
      row.status = "cancelled"; row.claim_token = null; row.claimed_at = nextClaim; profile.ai_consent_at = null;
    } });
    await processConnection(id);
    expect(f.row.claimed_at).toBe(nextClaim);
  });
});

describe("connection uncertain write recovery", () => {
  test("a committed ready image survives a lost success response", async () => {
    const f = fixture({ drawing: true, finalWrite: "lost-response" });
    expect(await processConnection(id)).toEqual({ processed: true, status: "ready" });
    expect(f.row.image_path).toBe(path); expect(f.objects.has(path)).toBe(true); expect(f.remove).not.toHaveBeenCalled();
  });

  test("an unknown database state preserves the upload for reconciliation", async () => {
    const f = fixture({ drawing: true, finalWrite: "lost-response", stateReadFailsAfterFinal: true });
    expect(await processConnection(id)).toEqual({ processed: true, status: "unknown" });
    expect(f.row.status).toBe("ready"); expect(f.objects.has(path)).toBe(true); expect(f.remove).not.toHaveBeenCalled();
  });

  test("a confirmed failed final write removes its unused upload and keeps the old image", async () => {
    const f = fixture({ drawing: true, previousImage: true, finalWrite: "rejected" });
    expect(await processConnection(id)).toEqual({ processed: true, status: "failed" });
    expect(f.row).toMatchObject({ status: "failed", image_path: previousPath, claimed_at: null,
      retry_after: new Date(now.getTime() + 5 * 60_000).toISOString(), entry_snapshot: [], artwork_summary: null, artwork_tags: [] });
    expect([...f.objects]).toEqual([previousPath]);
    expect(f.remove).toHaveBeenCalledWith([path]);
  });

  test("a lost failure-transition response preserves an upload with uncertain state", async () => {
    const f = fixture({ drawing: true, finalWrite: "rejected", failureResponseLost: true });
    expect(await processConnection(id)).toEqual({ processed: true, status: "unknown" });
    expect(f.objects.has(path)).toBe(true); expect(f.remove).not.toHaveBeenCalled();
  });

  test("a completion racing the failure transition keeps its referenced image", async () => {
    const f = fixture({ drawing: true, finalWrite: "rejected", beforeUpdate: (row, changes) => {
      if (changes.status === "failed") { row.status = "ready"; row.image_path = path; }
    } });
    expect(await processConnection(id)).toEqual({ processed: true, status: "unknown" });
    expect(f.row.status).toBe("ready"); expect(f.objects.has(path)).toBe(true); expect(f.remove).not.toHaveBeenCalled();
  });

  test("a failure cannot overwrite a newer worker's claim", async () => {
    const f = fixture({ drawing: true, finalWrite: "rejected", beforeUpdate: (row, changes) => {
      if (changes.status === "failed") row.claim_token = "bbb222";
    } });
    expect(await processConnection(id)).toEqual({ processed: true, status: "unknown" });
    expect(f.row).toMatchObject({ status: "processing", claim_token: "bbb222" }); expect(f.remove).not.toHaveBeenCalled();
  });

  test("a delayed final write cannot publish an object removed after confirmed failure", async () => {
    const f = fixture({ drawing: true, finalWrite: "pending" });
    expect(await processConnection(id)).toEqual({ processed: true, status: "failed" });
    expect(f.completeDelayedWrite()).toBe(false); expect(f.objects.size).toBe(0);
  });

  test("provider errors produce fixed copy and content-free logs", async () => {
    const f = fixture();
    dependencies.selectConnectionNews.mockRejectedValue(new Error("private-provider-content-and-secret"));
    expect(await processConnection(id)).toEqual({ processed: true, status: "failed" });
    expect(f.row).toMatchObject({ entry_snapshot: [], artwork_summary: null, artwork_tags: [] });
    expect(String(f.row.error_message)).not.toContain("private-provider");
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private-provider|비공개/);
    expect(dependencies.illustrate).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });
});
