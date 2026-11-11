import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  adminClient: vi.fn(),
  aiConfigured: vi.fn(),
  summarize: vi.fn(),
  illustrate: vi.fn()
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/server/core/supabase/server", () => ({ adminClient: dependencies.adminClient }));
vi.mock("../src/server/core/ai", () => ({ aiConfigured: dependencies.aiConfigured, summarize: dependencies.summarize, illustrate: dependencies.illustrate }));
import { processOne } from "../src/server/core/jobs";

type Row = Record<string, unknown> & {
  id: string;
  user_id: string;
  claim_token: string;
  status: string;
  image_path: string | null;
};
type Options = {
  finalWrite?: "ok" | "lost-response" | "rejected" | "pending";
  stateReadFails?: boolean;
  failureResponseLost?: boolean;
  beforeFailureWrite?: (row: Row, uploadedPath: string) => void;
};

// Model the database's conditional UPDATE semantics and the object store. Faults
// affect transport responses independently of whether a write actually committed.
function storageAndDatabase(options: Options = {}) {
  const row: Row = {
    id: "artwork-1", user_id: "user-1", claim_token: "claim-1", status: "processing", image_path: null,
    title: "기억할 하루", scene_summary: "따뜻한 하루", image_prompt: "A gentle watercolor scene",
    attempts: 1, art_style: "watercolor", entry_snapshot: []
  };
  const objects = new Set<string>();
  let uploadedPath = "";
  let delayedFinalWrite: (() => boolean) | undefined;
  const remove = vi.fn(async (paths: string[]) => {
    paths.forEach(path => objects.delete(path));
    return { error: null };
  });
  class Query {
    private changes?: Record<string, unknown>;
    private filters: Array<[string, unknown]> = [];
    update(changes: Record<string, unknown>) { this.changes = changes; return this; }
    select(_columns: string) { return this; }
    eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
    single() { return this.execute(false); }
    maybeSingle() { return this.execute(true); }
    private async execute(optional: boolean): Promise<{ data: Row | null; error: Error | null }> {
      const matches = () => this.filters.every(([key, value]) => row[key] === value);
      const apply = () => {
        if (!matches()) return false;
        Object.assign(row, this.changes);
        return true;
      };
      if (!this.changes) {
        if (options.stateReadFails) return { data: null, error: new Error("Network unavailable") };
        return { data: matches() ? { ...row } : null, error: null };
      }
      if (this.changes.status === "ready") {
        if (options.finalWrite === "pending") delayedFinalWrite = apply;
        else if (options.finalWrite !== "rejected") apply();
        if (options.finalWrite && options.finalWrite !== "ok") return { data: null, error: new Error("Response lost") };
      } else {
        if (this.changes.status === "failed") options.beforeFailureWrite?.(row, uploadedPath);
        if (!apply()) return { data: null, error: optional ? null : new Error("No matching row") };
        if (this.changes.status === "failed" && options.failureResponseLost) return { data: null, error: new Error("Response lost") };
      }
      return { data: { ...row }, error: null };
    }
  }
  const client = {
    rpc: vi.fn(async () => ({ data: [{ ...row }], error: null })),
    from: vi.fn(() => new Query()),
    storage: { from: vi.fn(() => ({
      upload: vi.fn(async (path: string) => { uploadedPath = path; objects.add(path); return { error: null }; }),
      remove
    })) }
  };
  dependencies.adminClient.mockReturnValue(client);
  return { row, objects, remove, completeDelayedWrite: () => delayedFinalWrite?.() };
}

beforeEach(() => {
  dependencies.aiConfigured.mockReturnValue(true);
  dependencies.illustrate.mockResolvedValue(Buffer.from("png test bytes"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("artwork final-write reconciliation", () => {
  test("keeps the uploaded image after a normal completed write", async () => {
    const state = storageAndDatabase();
    expect(await processOne()).toEqual({ processed: true, status: "ready" });
    expect(state.objects.has(state.row.image_path!)).toBe(true);
    expect(state.remove).not.toHaveBeenCalled();
  });
  test("recognizes a committed ready row when only the response was lost", async () => {
    const state = storageAndDatabase({ finalWrite: "lost-response" });
    expect(await processOne()).toEqual({ processed: true, status: "ready" });
    expect(state.row.status).toBe("ready");
    expect(state.objects.has(state.row.image_path!)).toBe(true);
    expect(state.remove).not.toHaveBeenCalled();
  });
  test("preserves the uploaded object when the database cannot be checked", async () => {
    const state = storageAndDatabase({ finalWrite: "lost-response", stateReadFails: true });
    expect(await processOne()).toEqual({ processed: true, status: "unknown" });
    expect(state.row.status).toBe("ready");
    expect(state.objects.has(state.row.image_path!)).toBe(true);
    expect(state.remove).not.toHaveBeenCalled();
  });
  test("removes an unreferenced upload only after a confirmed failure transition", async () => {
    const state = storageAndDatabase({ finalWrite: "rejected" });
    expect(await processOne()).toEqual({ processed: true, status: "failed" });
    expect(state.row.status).toBe("failed");
    expect(state.objects.size).toBe(0);
  });
  test("does not downgrade a completion that wins the race after reconciliation read", async () => {
    const state = storageAndDatabase({ finalWrite: "rejected", beforeFailureWrite: (row, path) => {
      row.status = "ready"; row.image_path = path;
    } });
    expect(await processOne()).toEqual({ processed: true, status: "unknown" });
    expect(state.row.status).toBe("ready");
    expect(state.objects.has(state.row.image_path!)).toBe(true);
    expect(state.remove).not.toHaveBeenCalled();
  });
  test("cannot fail a job after another worker has acquired its token", async () => {
    const state = storageAndDatabase({ finalWrite: "rejected", beforeFailureWrite: row => {
      row.claim_token = "claim-2";
    } });
    expect(await processOne()).toEqual({ processed: true, status: "unknown" });
    expect(state.row.status).toBe("processing");
    expect(state.row.claim_token).toBe("claim-2");
    expect(state.remove).not.toHaveBeenCalled();
  });
  test("preserves the upload if the failure-transition response is also lost", async () => {
    const state = storageAndDatabase({ finalWrite: "rejected", failureResponseLost: true });
    expect(await processOne()).toEqual({ processed: true, status: "unknown" });
    expect(state.objects.size).toBe(1);
    expect(state.remove).not.toHaveBeenCalled();
  });
  test("a delayed success cannot publish an image already cleaned after failure", async () => {
    const state = storageAndDatabase({ finalWrite: "pending" });
    expect(await processOne()).toEqual({ processed: true, status: "failed" });
    expect(state.completeDelayedWrite()).toBe(false);
    expect(state.row.status).toBe("failed");
    expect(state.row.image_path).toBeNull();
    expect(state.objects.size).toBe(0);
  });
});
