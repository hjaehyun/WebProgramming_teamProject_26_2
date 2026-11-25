import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Run the real provider's actions through persistent hook cells, without a DOM.
// Re-rendering exposes the next Context value just as a mounted consumer sees it.
const hooks = vi.hoisted(() => ({ cells: [] as unknown[], cursor: 0 }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.cells[index], (next: unknown) => { hooks.cells[index] = typeof next === "function" ? next(hooks.cells[index]) : next; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.cells)) hooks.cells[index] = { current: initial };
    return hooks.cells[index];
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));
import { StoreProvider } from "../src/lib/store";

const date = "2026-11-24";
const fetchMock = vi.fn<typeof fetch>();
function dashboard(id: string) {
  return { account: { id, email: `${id}@example.com` }, profile: { nick: id }, drafts: {}, artworks: {}, exhibition: { dates: [] }, capabilities: {} };
}
function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200 }); }
function renderStore() {
  hooks.cursor = 0;
  return StoreProvider({ children: null }).props.value;
}
beforeEach(() => {
  hooks.cells = []; hooks.cursor = 0; fetchMock.mockReset();
  vi.stubGlobal("React", React); vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("journal composer login-session boundary", () => {
  test("a route remount and same-account refresh retain separate drafts and editing IDs by date", async () => {
    fetchMock.mockImplementation(async () => response(dashboard("account-a")));
    await renderStore().refresh();
    const first = renderStore();
    first.setJournalComposer(date, { draft: "나의 미완성 글", editingId: "entry-a" });
    first.setJournalComposer("2026-11-23", { draft: "전날의 미완성 글" });
    await renderStore().refresh();
    expect(renderStore().journalComposers).toEqual({
      [date]: { draft: "나의 미완성 글", editingId: "entry-a" },
      "2026-11-23": { draft: "전날의 미완성 글" },
    });
  });

  test("logout clears every draft and rejects a late callback from the old account", async () => {
    fetchMock.mockImplementation(async (_url, options) => response(options?.method === "POST" ? {} : dashboard("account-a")));
    await renderStore().refresh();
    const old = renderStore();
    old.setJournalComposer(date, { draft: "비공개 글", saving: true });
    await old.signOut();
    old.setJournalComposer(date, { draft: "늦은 저장 콜백", saving: false });
    expect(renderStore().journalComposers).toEqual({});
    expect(old.isCurrentSession()).toBe(false);
    expect(renderStore().authed).toBe(false);
  });

  test("a cookie changed by another tab clears drafts before exposing the new account", async () => {
    fetchMock.mockResolvedValueOnce(response(dashboard("account-a"))).mockResolvedValueOnce(response(dashboard("account-b")));
    await renderStore().refresh();
    const old = renderStore();
    old.setJournalComposer(date, { draft: "A 계정의 개인 글", saving: true });
    await old.refresh();
    const next = renderStore();
    expect(next.db.account.id).toBe("account-b");
    expect(next.journalComposers).toEqual({});
    expect(old.isCurrentSession()).toBe(false);
    old.setJournalComposer(date, { draft: "A 계정의 늦은 콜백" });
    expect(renderStore().journalComposers).toEqual({});
    next.setJournalComposer(date, { draft: "B 계정의 새 글" });
    expect(renderStore().journalComposers[date].draft).toBe("B 계정의 새 글");
  });

  test("successful save clears only its date, leaving another day's unfinished text available", async () => {
    fetchMock.mockResolvedValue(response(dashboard("account-a")));
    await renderStore().refresh();
    const store = renderStore();
    store.setJournalComposer(date, { draft: "저장할 글" });
    store.setJournalComposer("2026-11-23", { draft: "계속 쓸 글" });
    store.setJournalComposer(date, null);
    expect(renderStore().journalComposers).toEqual({ "2026-11-23": { draft: "계속 쓸 글" } });
  });
});
