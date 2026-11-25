import { describe, expect, test, vi } from "vitest";
import { createJournalDraftSaver, journalLinkDestination } from "../src/lib/journal-draft";

const date = "2026-11-24";
const text = "늦게 남기는 하루";
const entry = { id: "entry-1", text };
const snapshot = (entries: typeof entry[]) => ({ drafts: { [date]: entries } });
function actions() {
  return {
    addEntry: vi.fn(() => entry), editEntry: vi.fn(async () => {}),
    flushEntries: vi.fn(async () => {}), refresh: vi.fn(async (_strict?: boolean): Promise<ReturnType<typeof snapshot> | null> => snapshot([])),
  };
}
const input = (overrides = {}) => ({ date, text, editingId: null, entries: [], ...overrides });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe("historical journal draft confirmation", () => {
  test("the input is not confirmed while its write is pending, and repeated saves share one create", async () => {
    const saver = createJournalDraftSaver(), api = actions(), wait = deferred();
    api.flushEntries.mockReturnValue(wait.promise);
    const first = saver.save(input(), api), second = saver.save(input(), api);
    let finished = false;
    void first.then(() => { finished = true; });
    await Promise.resolve();
    expect(first).toBe(second);
    expect(finished).toBe(false);
    expect(api.addEntry).toHaveBeenCalledTimes(1);
    wait.resolve();
    await expect(first).resolves.toEqual({ saved: true, error: null });
  });

  test("a rejected create keeps its input and allows a fresh retry only after the server confirms absence", async () => {
    const saver = createJournalDraftSaver(), api = actions();
    api.flushEntries.mockRejectedValueOnce(new Error("failed"));
    expect((await saver.save(input(), api)).saved).toBe(false);
    expect(api.refresh).toHaveBeenCalled();
    expect((await saver.save(input(), api)).saved).toBe(true);
    expect(api.addEntry).toHaveBeenCalledTimes(2);
  });

  test("an unknown result cannot create a duplicate while the server remains unreachable", async () => {
    const saver = createJournalDraftSaver(), api = actions();
    api.flushEntries.mockRejectedValueOnce(new Error("response lost"));
    api.refresh.mockResolvedValue(null);
    expect((await saver.save(input(), api)).saved).toBe(false);
    expect((await saver.save(input(), api)).saved).toBe(false);
    expect(api.refresh).toHaveBeenCalledWith(true);
    expect(api.addEntry).toHaveBeenCalledTimes(1);
  });

  test("a committed create with a lost response is recovered by ID without creating again", async () => {
    const saver = createJournalDraftSaver(), api = actions();
    api.flushEntries.mockRejectedValueOnce(new Error("response lost"));
    api.refresh.mockResolvedValueOnce(null).mockResolvedValue(snapshot([entry]));
    expect((await saver.save(input(), api)).saved).toBe(false);
    expect((await saver.save(input(), api)).saved).toBe(true);
    expect(api.addEntry).toHaveBeenCalledTimes(1);
    expect(api.editEntry).not.toHaveBeenCalled();
  });

  test("a recovery read that discovers another login cannot retry an old account's text", async () => {
    const saver = createJournalDraftSaver(), api = actions();
    let current = true;
    const sessionApi = { ...api, isCurrentSession: () => current };
    api.flushEntries.mockRejectedValueOnce(new Error("response lost"));
    api.refresh.mockResolvedValueOnce(null);
    await saver.save(input(), sessionApi);
    api.refresh.mockImplementation(async () => { current = false; return snapshot([]); });
    expect((await saver.save(input(), sessionApi)).saved).toBe(false);
    expect(api.addEntry).toHaveBeenCalledTimes(1);
    expect(api.editEntry).not.toHaveBeenCalled();
  });

  test("changing an uncertain new draft updates the recovered ID rather than adding a second entry", async () => {
    const saver = createJournalDraftSaver(), api = actions();
    api.flushEntries.mockRejectedValueOnce(new Error("response lost"));
    api.refresh.mockResolvedValueOnce(null).mockResolvedValue(snapshot([entry]));
    await saver.save(input(), api);
    expect((await saver.save(input({ text: "이어서 쓴 하루" }), api)).saved).toBe(true);
    expect(api.addEntry).toHaveBeenCalledTimes(1);
    expect(api.editEntry).toHaveBeenCalledWith(date, entry.id, "이어서 쓴 하루");
  });

  test("another failed write blocks navigation but does not retain an already confirmed input", async () => {
    const saver = createJournalDraftSaver(), api = actions();
    const failure = new Error("another entry failed");
    api.flushEntries.mockRejectedValueOnce(failure);
    api.refresh.mockResolvedValue(snapshot([entry]));
    expect(await saver.save(input(), api)).toEqual({ saved: true, error: failure });
  });

  test("an edit is kept on failure and retries its existing ID", async () => {
    const saver = createJournalDraftSaver(), api = actions();
    const original = { ...entry, text: "수정 전" };
    api.editEntry.mockRejectedValueOnce(new Error("edit failed"));
    api.refresh.mockResolvedValue(snapshot([original]));
    const edit = input({ editingId: entry.id, entries: [original] });
    expect((await saver.save(edit, api)).saved).toBe(false);
    expect((await saver.save(edit, api)).saved).toBe(true);
    expect(api.addEntry).not.toHaveBeenCalled();
    expect(api.editEntry).toHaveBeenCalledTimes(2);
  });

  test("an empty edit cannot silently replace a note or navigate away", async () => {
    const api = actions();
    const result = await createJournalDraftSaver().save(input({ editingId: entry.id, entries: [entry], text: "" }), api);
    expect(result.saved).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(api.addEntry).not.toHaveBeenCalled();
    expect(api.editEntry).not.toHaveBeenCalled();
  });
});

describe("journal navigation capture", () => {
  const location = new URL(`https://example.com/gallery/${date}`);
  function click(href: string, overrides = {}, anchorOverrides = {}) {
    const anchor = { href, target: "", hasAttribute: () => false, ...anchorOverrides };
    return { button: 0, target: { closest: () => anchor }, ...overrides };
  }
  test("calendar and cartoon links that replace the page can be held for confirmation", () => {
    expect(journalLinkDestination(click("/gallery?month=2026-11"), location)).toBe("/gallery?month=2026-11");
    expect(journalLinkDestination(click(`/cartoon?date=${date}`), location)).toBe(`/cartoon?date=${date}`);
  });
  test("new-tab, download, external, modified, and same-page links are not intercepted", () => {
    for (const event of [click("/gallery", { ctrlKey: true }), click("/gallery", { button: 1 }),
      click("/gallery", {}, { target: "_blank" }), click("/gallery", {}, { hasAttribute: () => true }),
      click("https://news.example/article"), click(`${location.href}#entries`)]) {
      expect(journalLinkDestination(event, location)).toBeNull();
    }
  });
});
