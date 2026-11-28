import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ userClient: vi.fn(), adminClient: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/server/core/supabase/server", () => mocks);
import { trashEmpty, trashList, trashPurge, trashRestore } from "../src/server/trash-handlers";
import { purgeAllExpiredTrash, purgeExpiredTrash, TRASH_DAYS } from "../src/server/trash-purge";

const alice = "00000000-0000-4000-8000-000000000001", bob = "00000000-0000-4000-8000-000000000002";
const art = "00000000-0000-4000-8000-000000000010", oldArt = "00000000-0000-4000-8000-000000000011", freshArt = "00000000-0000-4000-8000-000000000012";
const entry = "00000000-0000-4000-8000-000000000020", bundled = "00000000-0000-4000-8000-000000000021", other = "00000000-0000-4000-8000-000000000022";
const origin = "http://127.0.0.1:3001";
type Row = Record<string, any>;
const day = (n: number) => new Date(Date.UTC(2026, 10, 28) - n * 86400000).toISOString();

// A small in-memory stand-in for the Supabase query builder: filters, ordering, delete.
function fakeDb(tables: Record<string, Row[]>, user: Row | null, log: string[]) {
  class Query {
    filters: Array<(r: Row) => boolean> = []; removing = false; max = Infinity; sort?: [string, boolean];
    constructor(public table: string) {}
    select() { return this; }
    eq(k: string, v: unknown) { this.filters.push(r => r[k] === v); return this; }
    is(k: string, v: unknown) { this.filters.push(r => (r[k] ?? null) === v); return this; }
    lt(k: string, v: string) { this.filters.push(r => r[k] < v); return this; }
    lte(k: string, v: string) { this.filters.push(r => r[k] <= v); return this; }
    in(k: string, v: unknown[]) { this.filters.push(r => v.includes(r[k])); return this; }
    order(k: string, o?: { ascending?: boolean }) { this.sort = [k, o?.ascending !== false]; return this; }
    range(a: number, b: number) { this.max = b - a + 1; return this; }
    limit(n: number) { this.max = n; return this; }
    delete() { this.removing = true; return this; }
    result() {
      let rows = (tables[this.table] ?? []).filter(r => this.filters.every(f => f(r)));
      if (this.sort) { const [k, asc] = this.sort; rows = [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1)); }
      rows = rows.slice(0, this.max);
      if (this.removing) { log.push(`delete ${this.table}`); tables[this.table] = (tables[this.table] ?? []).filter(r => !rows.includes(r)); }
      return { data: rows, error: null };
    }
    async maybeSingle() { return { data: this.result().data[0] ?? null, error: null }; }
    async single() { return this.maybeSingle(); }
    then(resolve: any, reject: any) { return Promise.resolve(this.result()).then(resolve, reject); }
  }
  const bucket = {
    list: vi.fn(async (folder: string) => { log.push(`list ${folder}`); return { data: [{ id: "f", name: "a.png" }], error: null }; }),
    remove: vi.fn(async (paths: string[]) => { log.push(`remove ${paths.join(",")}`); return { data: [], error: null as unknown }; }),
    createSignedUrls: vi.fn(async (paths: string[]) => ({ data: paths.map(path => ({ path, signedUrl: `https://storage.invalid/${path}?token=t` })), error: null })),
  };
  const db = {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    from: (t: string) => new Query(t),
    rpc: vi.fn(async (name: string, args?: Row) => { log.push(`rpc ${name}`); return name === "restore_trash_item" ? { data: { restored: "artwork", date: "2026-11-27" }, error: null } : { data: 2, error: null }; }),
    storage: { from: () => bucket },
  };
  return { db, bucket };
}
function fixture() {
  const log: string[] = [];
  const tables: Record<string, Row[]> = {
    profiles: [{ id: alice, deleting_at: null }],
    trashed_entries: [
      { id: entry, user_id: alice, entry_date: "2026-11-26", artwork_id: null, deleted_at: day(1), data: { id: entry, user_id: alice, content: "산책", created_at: "2026-11-26T01:00:00Z" } },
      { id: bundled, user_id: alice, entry_date: "2026-11-27", artwork_id: art, deleted_at: day(2), data: { id: bundled, user_id: alice, content: "마지막 조각", created_at: "2026-11-27T02:00:00Z" } },
      { id: other, user_id: bob, entry_date: "2026-11-27", artwork_id: null, deleted_at: day(1), data: { content: "밥의 기록" } },
    ],
    trashed_artworks: [
      { id: art, user_id: alice, artwork_date: "2026-11-27", image_path: `${alice}/${art}/a.png`, deleted_at: day(2), data: { id: art, user_id: alice, frame: "wood", scene: "park", status: "ready", image_prompt: "secret prompt" } },
    ],
  };
  const user = { id: alice, email: "alice@example.test" };
  const f = fakeDb(tables, user, log);
  return { ...f, tables, log };
}
function request(path: string, method: string, requestOrigin = origin) {
  return new Request(origin + path, { method, headers: { Origin: requestOrigin, "Content-Type": "application/json" } });
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
  vi.clearAllMocks(); f = fixture();
  mocks.configured.mockReturnValue(true); mocks.userClient.mockResolvedValue(f.db); mocks.adminClient.mockReturnValue(f.db);
  vi.stubEnv("APP_URL", origin);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("trash list", () => {
  test("shows the caller's items newest first, pictures with their fragments, without ids or storage paths of the owner", async () => {
    const r = await trashList(); expect(r.status).toBe(200);
    const { items } = await r.json(); const serialized = JSON.stringify(items);
    expect(items.map((i: Row) => [i.kind, i.id])).toEqual([["entry", entry], ["artwork", art]]);
    expect(items[0]).toEqual({ id: entry, kind: "entry", date: "2026-11-26", text: "산책", deletedAt: day(1), purgeAt: new Date(Date.parse(day(1)) + TRASH_DAYS * 86400000).toISOString() });
    expect(items[1]).toMatchObject({ kind: "artwork", date: "2026-11-27", entries: ["마지막 조각"], frame: "wood", scene: "park", imageUrl: `https://storage.invalid/${alice}/${art}/a.png?token=t` });
    for (const value of [alice, bob, "밥의 기록", "image_path", "secret prompt", "user_id"]) expect(serialized).not.toContain(value === alice ? `"${alice}"` : value);
  });
});

describe("permanent deletion", () => {
  test("a picture's files are removed before its row", async () => {
    const r = await trashPurge(request(`/api/me/trash/${art}`, "DELETE"), art);
    expect(r.status).toBe(200);
    expect(f.log).toEqual([`list ${alice}/${art}`, `remove ${alice}/${art}/a.png`, "rpc purge_trash_item"]);
    expect(f.db.rpc).toHaveBeenCalledWith("purge_trash_item", { p_id: art });
  });
  test("if the files cannot be removed the row stays, to try again later", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.bucket.remove.mockResolvedValueOnce({ data: [], error: new Error("Storage unavailable") });
    expect((await trashPurge(request(`/api/me/trash/${art}`, "DELETE"), art)).status).toBe(503);
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  test("a fragment needs no storage work", async () => {
    expect((await trashPurge(request(`/api/me/trash/${entry}`, "DELETE"), entry)).status).toBe(200);
    expect(f.log).toEqual(["rpc purge_trash_item"]);
  });
  test("emptying removes picture files, then everything up to the newest listed item", async () => {
    const r = await trashEmpty(request("/api/me/trash", "DELETE"));
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true, removed: 2 });
    expect(f.log).toEqual([`list ${alice}/${art}`, `remove ${alice}/${art}/a.png`, "rpc empty_trash"]);
    expect(f.db.rpc).toHaveBeenCalledWith("empty_trash", { p_until: day(1) });
  });
  test("emptying an empty trash does nothing", async () => {
    f.tables.trashed_entries = []; f.tables.trashed_artworks = [];
    expect(await (await trashEmpty(request("/api/me/trash", "DELETE"))).json()).toEqual({ ok: true, removed: 0 });
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
});

describe("restore and boundaries", () => {
  test("restore passes the database result through", async () => {
    const r = await trashRestore(request(`/api/me/trash/${art}/restore`, "POST"), art);
    expect(await r.json()).toEqual({ ok: true, restored: "artwork", date: "2026-11-27" });
    expect(f.db.rpc).toHaveBeenCalledWith("restore_trash_item", { p_id: art });
  });
  test("other origins, signed-out callers and malformed ids are refused before any work", async () => {
    expect((await trashRestore(request(`/api/me/trash/${art}/restore`, "POST", "https://another.invalid"), art)).status).toBe(403);
    expect((await trashPurge(request("/api/me/trash/x", "DELETE"), "x")).status).toBe(400);
    f.db.auth.getUser.mockResolvedValue({ data: { user: null }, error: null } as never);
    expect((await trashEmpty(request("/api/me/trash", "DELETE"))).status).toBe(401);
    expect((await trashList()).status).toBe(401);
    expect(f.db.rpc).not.toHaveBeenCalled(); expect(f.bucket.remove).not.toHaveBeenCalled();
  });
});

describe("expired trash", () => {
  test("items older than 30 days are purged with their files; newer ones and failed file removals stay", async () => {
    const now = new Date(Date.UTC(2026, 10, 28));
    f.tables.trashed_artworks = [
      { id: oldArt, user_id: alice, artwork_date: "2026-10-01", deleted_at: day(31), data: {} },
      { id: art, user_id: alice, artwork_date: "2026-10-02", deleted_at: day(32), data: {} },
      { id: freshArt, user_id: alice, artwork_date: "2026-11-20", deleted_at: day(29), data: {} },
    ];
    f.tables.trashed_entries = [
      { id: bundled, user_id: alice, artwork_id: oldArt, deleted_at: day(31), data: {} },
      { id: entry, user_id: alice, artwork_id: null, deleted_at: day(31), data: {} },
      { id: other, user_id: bob, artwork_id: null, deleted_at: day(3), data: {} },
    ];
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.bucket.remove.mockImplementation(async (paths: string[]) => ({ data: [], error: paths[0].includes(art) ? new Error("Storage unavailable") : null }));
    expect(await purgeExpiredTrash(now)).toEqual({ artworks: 1, entries: 2 });
    expect(f.tables.trashed_artworks.map(r => r.id).sort()).toEqual([art, freshArt].sort());
    expect(f.tables.trashed_entries.map(r => r.id)).toEqual([other]);
  });
  test("the daily run keeps purging in batches until nothing expired is left, and stops when files keep failing", async () => {
    const now = new Date(Date.UTC(2026, 10, 28));
    f.tables.trashed_entries = [];
    f.tables.trashed_artworks = [oldArt, art, freshArt].map((id, i) => ({ id, user_id: alice, artwork_date: "2026-10-01", deleted_at: day(31 + i), data: {} }));
    expect(await purgeAllExpiredTrash(now, { limit: 2 })).toEqual({ artworks: 3, entries: 0 });
    expect(f.tables.trashed_artworks).toEqual([]);
    f.tables.trashed_artworks = [{ id: art, user_id: alice, artwork_date: "2026-10-01", deleted_at: day(40), data: {} }];
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.bucket.remove.mockResolvedValue({ data: [], error: new Error("Storage unavailable") });
    expect(await purgeAllExpiredTrash(now, { limit: 1 })).toEqual({ artworks: 0, entries: 0 });
    expect(f.tables.trashed_artworks).toHaveLength(1);
  });
});
