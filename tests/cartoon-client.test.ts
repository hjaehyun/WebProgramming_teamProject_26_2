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
  test("an eligible empty today starts once with its displayed date and serializes concurrent actions", async () => {
    const post = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockImplementationOnce(() => post.promise)
      .mockImplementation(async () => response(snapshot("processing")));
    const screen = mount();
    await settle();
    expect(methods()).toEqual(["GET", "POST"]);
    expect(screen.view.posting).toBe(true);
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ date: today });
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

  test.each([today, yesterday])("an unavailable %s edition waits for explicit reselection through refresh and visibility changes", async date => {
    const unavailable = snapshot("unavailable", { canRequest: true, cartoon: { date, status: "unavailable", attempts: 1, retryAt: null } });
    fetchMock.mockImplementation(async (_url, options) => response(options?.method === "POST"
      ? snapshot("processing", { cartoon: { date, status: "processing", attempts: 2 } }) : unavailable));
    const screen = mount(date);
    await settle();
    await screen.session.refresh();
    page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
    page.hidden = false; page.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(methods()).toEqual(["GET", "GET", "GET"]);
    expect(screen.view.payload?.canRequest).toBe(true);
    await screen.session.start();
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ date });
    expect(screen.view.payload?.cartoon?.status).toBe("processing");
  });

  test.each([today, yesterday])("an unavailable %s cooldown refreshes permission without automatically searching again", async date => {
    const retryAt = new Date(now.getTime() + 10000).toISOString();
    fetchMock.mockResolvedValueOnce(response(snapshot("unavailable", { cartoon: { date, status: "unavailable", retryAt } })))
      .mockResolvedValueOnce(response(snapshot("unavailable", { canRequest: true, cartoon: { date, status: "unavailable", retryAt } })))
      .mockResolvedValueOnce(response(snapshot("processing", { cartoon: { date, status: "processing" } })));
    const screen = mount(date, new Set([date]));
    await settle();
    await screen.session.start();
    expect(methods()).toEqual(["GET"]);
    await vi.advanceTimersByTimeAsync(11000);
    expect(methods()).toEqual(["GET", "GET"]);
    expect(screen.view.payload?.canRequest).toBe(true);
    expect(screen.view.posting).toBe(false);
    await screen.session.start();
    expect(methods()).toEqual(["GET", "GET", "POST"]);
  });

  test("an unavailable edition with exhausted attempts makes no request beyond reading its state", async () => {
    fetchMock.mockImplementation(async () => response(snapshot("unavailable", { cartoon: { date: today, status: "unavailable", attempts: 3, retryAt: null } })));
    const screen = mount(today);
    await settle();
    await screen.session.start();
    await vi.advanceTimersByTimeAsync(15 * 60000);
    expect(methods()).toEqual(["GET"]);
    expect(screen.view.payload?.canRequest).toBe(false);
  });

  test.each(["network", "server", "invalid-json"])("an unavailable cooldown survives a transient %s read failure without automatically retrying generation", async failure => {
    const retryAt = new Date(now.getTime() + 10000).toISOString();
    const oldResult = snapshot("unavailable", { cartoon: { date: today, status: "unavailable", retryAt } });
    fetchMock.mockResolvedValueOnce(response(oldResult));
    if (failure === "network") fetchMock.mockRejectedValueOnce(new TypeError("connection lost"));
    else fetchMock.mockResolvedValueOnce(failure === "server" ? response({ error: "Try later" }, 503) : new Response("{incomplete"));
    fetchMock.mockResolvedValueOnce(response({ ...oldResult, canRequest: true }));
    const screen = mount(today);
    await settle();
    await vi.advanceTimersByTimeAsync(11000);
    expect(screen.view.payload?.canRequest).toBe(false);
    expect(screen.view.error).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.payload?.canRequest).toBe(true);
    expect(screen.view.error).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a publication-time read failure retries status before starting the newly eligible edition", async () => {
    vi.setSystemTime(new Date("2026-11-25T09:59:58Z"));
    fetchMock.mockResolvedValueOnce(response(snapshot()))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockResolvedValueOnce(response(snapshot("ready")));
    mount();
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(posts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(methods()).toEqual(["GET", "GET", "GET", "POST"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a lost POST response observes briefly and does not loop POST while canRequest remains true", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockImplementation(async () => response(snapshot(null, { canRequest: true })));
    const screen = mount();
    await settle();
    expect(screen.view.error).toBe("connection lost");
    expect(screen.view.posting).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await screen.session.refresh();
    await screen.session.refresh();
    await vi.advanceTimersByTimeAsync(60000);
    expect(posts()).toHaveLength(1);
    expect(screen.view.posting).toBe(false);
    expect(screen.autoRequested.has(today)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["failed", "unavailable"])("a lost %s retry response keeps observing an old row until the accepted job becomes visible", async status => {
    const oldResult = snapshot(status, { canRequest: true, cartoon: { date: yesterday, status, attempts: 1, retryAt: null } });
    fetchMock.mockResolvedValueOnce(response(oldResult))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(response(oldResult))
      .mockResolvedValueOnce(response(snapshot("processing", { cartoon: { date: yesterday, status: "processing", attempts: 2 } })))
      .mockResolvedValueOnce(response(snapshot("ready", { cartoon: { date: yesterday, status: "ready", attempts: 2 } })));
    const screen = mount(yesterday);
    await settle(); await screen.session.start();
    expect(screen.view.posting).toBe(true);
    expect(screen.view.error).toBe("connection lost");
    await screen.session.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.view.payload?.cartoon?.status).toBe(status);
    expect(screen.view.posting).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.payload?.cartoon?.status).toBe("processing");
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.payload?.cartoon?.status).toBe("ready");
    expect(posts()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([400, 403, 409, 429])("an explicitly rejected POST (%s) reads once without waiting for a job to start", async status => {
    const oldResult = snapshot("unavailable", { canRequest: true, cartoon: { date: yesterday, status: "unavailable", attempts: 1, retryAt: null } });
    fetchMock.mockResolvedValueOnce(response(oldResult))
      .mockResolvedValueOnce(response({ error: "Request rejected" }, status))
      .mockImplementation(async () => response(oldResult));
    const screen = mount(yesterday);
    await settle(); await screen.session.start();
    expect(screen.view.posting).toBe(false);
    expect(screen.view.error).toBe("Request rejected");
    await vi.advanceTimersByTimeAsync(30000);
    expect(methods()).toEqual(["GET", "POST", "GET"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a lost POST keeps checking status through a transient read failure at the observation deadline", async () => {
    const oldResult = snapshot("unavailable", { canRequest: true, cartoon: { date: yesterday, status: "unavailable", attempts: 1, retryAt: null } });
    fetchMock.mockResolvedValueOnce(response(oldResult))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockImplementation(async () => {
        if (Date.now() === now.getTime() + 30000) throw new TypeError("status unavailable");
        return response(Date.now() > now.getTime() + 30000
          ? snapshot("ready", { cartoon: { date: yesterday, status: "ready", attempts: 2 } }) : oldResult);
      });
    const screen = mount(yesterday);
    await settle(); await screen.session.start();
    await vi.advanceTimersByTimeAsync(30000);
    expect(screen.view.error).toBe("status unavailable");
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.payload?.cartoon?.status).toBe("ready");
    expect(posts()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([401, 403])("a processing read rejected with %s stops automatic polling until explicit refresh", async status => {
    fetchMock.mockResolvedValueOnce(response(snapshot("processing")))
      .mockResolvedValueOnce(response({ error: "Access denied" }, status))
      .mockResolvedValueOnce(response(snapshot("ready")));
    const screen = mount(today);
    await settle();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.error).toBe("Access denied");
    await vi.advanceTimersByTimeAsync(60000);
    expect(methods()).toEqual(["GET", "GET"]);
    expect(vi.getTimerCount()).toBe(0);
    await screen.session.refresh();
    expect(screen.view.payload?.cartoon?.status).toBe("ready");
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

  test("a past date waits for explicit generation and never clears today's attempt latch", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot(null)))
      .mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockResolvedValueOnce(response(snapshot("processing", { cartoon: { date: yesterday, status: "processing" } })));
    const screen = mount(yesterday, new Set([today]));
    await settle();
    expect(screen.autoRequested.has(today)).toBe(true);
    await screen.session.refresh();
    expect(posts()).toHaveLength(0);
    await screen.session.start();
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ date: yesterday });
    expect(screen.autoRequested.has(today)).toBe(true);
    expect(screen.view.payload?.cartoon?.date).toBe(yesterday);
  });

  test.each(["queued", "processing"])("an already requested past %s job may automatically resume", async status => {
    fetchMock.mockResolvedValueOnce(response(snapshot(status, { canRequest: true, cartoon: { date: yesterday, status } })))
      .mockResolvedValueOnce(response(snapshot("processing", { cartoon: { date: yesterday, status: "processing" } })));
    const screen = mount(yesterday);
    await settle();
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ date: yesterday });
    expect(screen.view.payload?.cartoon?.date).toBe(yesterday);
  });

  test("a past failure refreshes permission after cooldown but waits for manual retry", async () => {
    const retryAt = new Date(now.getTime() + 10000).toISOString();
    fetchMock.mockResolvedValueOnce(response(snapshot("failed", { cartoon: { date: yesterday, status: "failed", retryAt } })))
      .mockResolvedValueOnce(response(snapshot("failed", { canRequest: true, cartoon: { date: yesterday, status: "failed" } })))
      .mockResolvedValueOnce(response(snapshot("processing", { cartoon: { date: yesterday, status: "processing" } })));
    const screen = mount(yesterday, new Set([yesterday]));
    await settle();
    await vi.advanceTimersByTimeAsync(11000);
    expect(methods()).toEqual(["GET", "GET"]);
    expect(screen.view.payload?.canRequest).toBe(true);
    await screen.session.start();
    expect(methods()).toEqual(["GET", "GET", "POST"]);
  });

  test.each(["failed", "unavailable"])("an accepted past retry keeps observing the old %s row until processing and ready appear", async status => {
    const failed = snapshot(status, { canRequest: true, cartoon: { date: yesterday, status, retryAt: now.toISOString() } });
    fetchMock.mockResolvedValueOnce(response(failed))
      .mockResolvedValueOnce(response(failed, 202))
      .mockResolvedValueOnce(response(failed))
      .mockResolvedValueOnce(response(snapshot("processing", { cartoon: { date: yesterday, status: "processing" } })))
      .mockResolvedValueOnce(response(snapshot("ready", { cartoon: { date: yesterday, status: "ready" } })));
    const screen = mount(yesterday);
    await settle(); await screen.session.start();
    expect(screen.view.posting).toBe(true);
    await screen.session.start();
    expect(posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.posting).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.payload?.cartoon?.status).toBe("processing");
    expect(screen.view.posting).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.payload?.cartoon?.status).toBe("ready");
    expect(posts()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["failed", "unavailable"])("an accepted %s retry with no visible start stops observing after thirty seconds without another POST", async status => {
    const failed = snapshot(status, { canRequest: true, cartoon: { date: yesterday, status, retryAt: now.toISOString() } });
    fetchMock.mockImplementation(async (_url, options) => response(failed, options?.method === "POST" ? 202 : 200));
    const screen = mount(yesterday);
    await settle(); await screen.session.start();
    await vi.advanceTimersByTimeAsync(29999);
    expect(screen.view.posting).toBe(true);
    expect(posts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.view.posting).toBe(false);
    expect(screen.view.payload?.cartoon?.status).toBe(status);
    expect(vi.getTimerCount()).toBe(0);
    const callsAtDeadline = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAtDeadline);
    expect(posts()).toHaveLength(1);
  });

  test.each(["failed", "unavailable"])("a fresh %s cooldown ends accepted-retry waiting without waiting for the deadline", async status => {
    const failed = snapshot(status, { canRequest: true, cartoon: { date: yesterday, status, retryAt: now.toISOString() } });
    const retryAt = new Date(now.getTime() + 15 * 60000).toISOString();
    fetchMock.mockResolvedValueOnce(response(failed))
      .mockResolvedValueOnce(response(failed, 202))
      .mockResolvedValueOnce(response(snapshot(status, { cartoon: { date: yesterday, status, retryAt } })));
    const screen = mount(yesterday);
    await settle(); await screen.session.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.view.posting).toBe(false);
    expect(screen.view.payload?.canRequest).toBe(false);
    const callsAfterClaim = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterClaim);
    expect(posts()).toHaveLength(1);
  });

  test("an edition opened before midnight still sends that edition's date after midnight", async () => {
    const post = deferred<Response>();
    fetchMock.mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockImplementationOnce(() => post.promise);
    const screen = mount(today);
    await settle();
    vi.setSystemTime(new Date("2026-11-25T15:00:01Z"));
    post.resolve(response(snapshot("ready", { today: "2026-11-26" })));
    await settle();
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ date: today });
    expect(screen.view.payload?.cartoon?.date).toBe(today);
    expect(screen.view.error).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  test("a mismatched read cannot display or start another day's edition", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot("ready", { canRequest: true })));
    const screen = mount(yesterday);
    await settle();
    expect(screen.view.payload).toBeNull();
    expect(screen.view.error).toContain("선택한 날짜");
    await screen.session.start();
    expect(posts()).toHaveLength(0);
  });

  test("a lost past-date POST reads its original date without starting a second job", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot(null, { canRequest: true })))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(response(snapshot("processing", { cartoon: { date: yesterday, status: "processing" } })));
    const screen = mount(yesterday);
    await settle(); await screen.session.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock.mock.calls[2][0]).toBe(`/api/cartoons?date=${yesterday}`);
    expect(screen.view.payload?.cartoon?.date).toBe(yesterday);
    expect(posts()).toHaveLength(1);
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
