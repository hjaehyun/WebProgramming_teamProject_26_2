import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createEditionSession } from "../src/lib/cartoon-client";

const today = "2026-11-25", yesterday = "2026-11-24";
const now = new Date("2026-11-25T10:10:00Z"); // 19:10 KST
const fetchMock = vi.fn<typeof fetch>();
class PageVisibility extends EventTarget { hidden = false; }
let page: PageVisibility;
const sessions: ReturnType<typeof createEditionSession>[] = [];

function snapshot(status: string | null = null, options: Record<string, unknown> = {}) {
  return {
    cartoon: status ? { date: today, status, stage: "searching", retryAt: null } : null,
    today, dates: [today, yesterday], enabled: true, canRequest: false,
    availableAt: `${today}T19:00:00+09:00`, ...options,
  };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
type View = {
  payload: ReturnType<typeof snapshot> | null; error: string | null;
  loading: boolean; posting: boolean; fetchedAt: number;
};
function mount(date: string | null = null, autoRequested = new Set<string>()) {
  let view: View = { payload: null, error: null, loading: true, posting: false, fetchedAt: 0 };
  const update = vi.fn((change: View | ((previous: View) => View)) => {
    view = typeof change === "function" ? change(view) : change;
  });
  const session = createEditionSession({ requestedDate: date, autoRequested, onChange: update });
  sessions.push(session);
  return { session, update, autoRequested, get view() { return view; } };
}
const settle = () => vi.advanceTimersByTimeAsync(0);
const methods = () => fetchMock.mock.calls.map(([, options]) => options?.method);
const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  page = new PageVisibility();
  vi.stubGlobal("document", page); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  sessions.splice(0).forEach(session => session.dispose());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("daily cartoon hook request lifecycle", () => {
  test("an eligible empty today starts once with an empty body and serializes concurrent actions", async () => {
    const post = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockImplementationOnce(() => post.promise)
      .mockImplementation(async () => response(snapshot("processing")));
    const screen = mount();
    await settle();
    expect(methods()).toEqual(["GET", "POST"]);
    expect(screen.view.posting).toBe(true);
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({});
    await screen.session.refresh();
    await screen.session.start();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    post.resolve(response(snapshot("processing"), 202));
    await settle();
    expect(screen.view.payload?.cartoon?.status).toBe("processing");
    await vi.advanceTimersByTimeAsync(5000);
    expect(methods()).toEqual(["GET", "POST", "GET"]);
    expect(posts()).toHaveLength(1);
  });

  test.each(["queued", "processing"])("a recoverable %s job automatically resumes without a fake ready state", async status => {
    fetchMock.mockResolvedValueOnce(response(snapshot(status, { canRequest: true })))
      .mockResolvedValueOnce(response(snapshot("processing"), 202));
    const screen = mount(today);
    await settle();
    expect(methods()).toEqual(["GET", "POST"]);
    expect(screen.view.payload?.cartoon?.status).toBe("processing");
    expect(screen.view.posting).toBe(false);
  });

  test("a server-owned lease resets the latch so a later stale job can be recovered", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockResolvedValueOnce(response(snapshot("processing"), 202))
      .mockResolvedValueOnce(response(snapshot("processing")))
      .mockResolvedValueOnce(response(snapshot("processing", { canRequest: true })))
      .mockResolvedValueOnce(response(snapshot("ready")));
    const screen = mount();
    await settle();
    expect(posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.autoRequested.has(today)).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(posts()).toHaveLength(2);
    expect(screen.view.payload?.cartoon?.status).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a failed job waits until retryAt, reads the new permission, and then retries", async () => {
    const retryAt = new Date(now.getTime() + 10000).toISOString();
    fetchMock.mockResolvedValueOnce(response(snapshot("failed", { cartoon: { date: today, status: "failed", retryAt } })))
      .mockResolvedValueOnce(response(snapshot("failed", { canRequest: true })))
      .mockResolvedValueOnce(response(snapshot("ready")));
    const screen = mount(null, new Set([today]));
    await settle();
    expect(screen.autoRequested.has(today)).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(methods()).toEqual(["GET"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(methods()).toEqual(["GET", "GET", "POST"]);
    expect(screen.view.payload?.cartoon?.status).toBe("ready");
  });

  test("a lost POST response checks once and does not loop POST while canRequest remains true", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockImplementation(async () => response(snapshot(null, { canRequest: true })));
    const screen = mount();
    await settle();
    expect(screen.view.error).toBe("connection lost");
    await vi.advanceTimersByTimeAsync(1000);
    await screen.session.refresh();
    await screen.session.refresh();
    await vi.advanceTimersByTimeAsync(60000);
    expect(posts()).toHaveLength(1);
    expect(screen.autoRequested.has(today)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("changing dates aborts the old reader and ignores it even if it still resolves", async () => {
    const oldRead = deferred<Response>();
    fetchMock.mockImplementationOnce(() => oldRead.promise)
      .mockResolvedValueOnce(response(snapshot("ready")));
    const oldScreen = mount(yesterday);
    const oldSignal = fetchMock.mock.calls[0][1]?.signal;
    oldScreen.session.dispose();
    const newScreen = mount(today);
    await settle();
    expect(oldSignal?.aborted).toBe(true);
    expect(newScreen.view.payload?.cartoon?.date).toBe(today);
    oldRead.resolve(response(snapshot("ready", { cartoon: { date: yesterday, status: "ready", retryAt: null } })));
    await settle();
    expect(oldScreen.update).not.toHaveBeenCalled();
    expect(newScreen.view.payload?.cartoon?.date).toBe(today);
    expect(posts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("polling pauses while hidden and resumes with one read on visibility", async () => {
    fetchMock.mockImplementation(async () => response(snapshot("processing")));
    mount();
    await settle();
    page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    page.hidden = false; page.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(posts()).toHaveLength(0);
  });

  test("a past date never starts a job and never clears today's attempt latch", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot(null)))
      .mockResolvedValueOnce(response(snapshot(null, { canRequest: true })));
    const screen = mount(yesterday, new Set([today]));
    await settle();
    expect(screen.autoRequested.has(today)).toBe(true);
    await screen.session.refresh();
    await screen.session.start();
    expect(posts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("before publication time it waits for availableAt and checks permission before starting", async () => {
    vi.setSystemTime(new Date("2026-11-25T09:59:58Z"));
    fetchMock.mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockResolvedValueOnce(response(snapshot("ready")));
    mount();
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(methods()).toEqual(["GET"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(methods()).toEqual(["GET", "GET", "POST"]);
  });
});
