import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createConnectionSession } from "../src/lib/connection-client";

const date = "2026-11-04", today = "2026-11-25";
const now = new Date("2026-11-25T10:00:00Z");
const requestId = "11111111-1111-4111-8111-111111111111";
const fetchMock = vi.fn<typeof fetch>();
class PageVisibility extends EventTarget { hidden = false; }
let page: PageVisibility;
const sessions: ReturnType<typeof createConnectionSession>[] = [];

function snapshot(status: string | null = null, overrides: Record<string, unknown> = {}) {
  return {
    date, today, dates: [date], enabled: true, consent: true, hasEntries: true,
    canRequest: status === null || status === "failed", canRefresh: status === "ready" || status === "no_match", retryAt: null,
    connection: status ? { id: "connection-1", date, status, stage: "topics", attempts: 1 } : null, ...overrides,
  };
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
type View = { payload: ReturnType<typeof snapshot> | null; error: string | null; loading: boolean; posting: boolean; fetchedAt: number };
function mount(selectedDate = date, beforeStart: () => Promise<void> = vi.fn(async () => {})) {
  let view: View = { payload: null, error: null, loading: true, posting: false, fetchedAt: 0 };
  const update = vi.fn((change: View | ((previous: View) => View)) => { view = typeof change === "function" ? change(view) : change; });
  const session = createConnectionSession({ date: selectedDate, beforeStart, onChange: update });
  sessions.push(session);
  return { session, update, beforeStart, get view() { return view; } };
}
const settle = () => vi.advanceTimersByTimeAsync(0);
const methods = () => fetchMock.mock.calls.map(([, options]) => options?.method);
const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  page = new PageVisibility();
  vi.stubGlobal("document", page); vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => requestId) });
  fetchMock.mockReset();
});
afterEach(() => {
  sessions.splice(0).forEach(session => session.dispose());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("private connection request lifecycle", () => {
  test("an eligible first visit never sends a generation request", async () => {
    fetchMock.mockResolvedValue(response(snapshot()));
    const screen = mount();
    await settle();
    expect(screen.view.payload?.canRequest).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(methods()).toEqual(["GET"]);
    expect(screen.beforeStart).not.toHaveBeenCalled();
  });

  test("explicit generation flushes saved fragments first, prevents double clicks and polls the approved job", async () => {
    const saving = deferred<void>();
    fetchMock.mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(response(snapshot("queued"), 202))
      .mockResolvedValueOnce(response(snapshot("ready")));
    const screen = mount(date, vi.fn(() => saving.promise));
    await settle();
    const start = screen.session.start();
    await screen.session.start(); await screen.session.refresh();
    expect(screen.view.posting).toBe(true);
    expect(methods()).toEqual(["GET"]);
    saving.resolve(); await start;
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ date, refresh: false, requestId });
    expect(screen.view.payload?.connection?.status).toBe("queued");
    await vi.advanceTimersByTimeAsync(5000);
    expect(methods()).toEqual(["GET", "POST", "GET"]);
    expect(screen.view.payload?.connection?.status).toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["ready", "no_match"])("cached %s stays unchanged until explicit refresh:true", async status => {
    fetchMock.mockResolvedValueOnce(response(snapshot(status)))
      .mockResolvedValueOnce(response(snapshot("processing"), 202));
    const screen = mount(); await settle();
    await vi.advanceTimersByTimeAsync(7 * 86400000);
    await screen.session.start(false);
    expect(posts()).toHaveLength(0);
    await screen.session.start(true);
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ date, refresh: true, requestId });
    expect(screen.view.payload?.connection?.status).toBe("processing");
  });

  test("a failed result wakes at retryAt but waits for a new user request", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot("failed", { canRequest: false, retryAt: new Date(now.getTime() + 300000).toISOString() })))
      .mockResolvedValueOnce(response(snapshot("failed")));
    const screen = mount(); await settle();
    await screen.session.start();
    await vi.advanceTimersByTimeAsync(300000);
    expect(methods()).toEqual(["GET"]);
    await vi.advanceTimersByTimeAsync(250);
    expect(methods()).toEqual(["GET", "GET"]);
    expect(screen.view.payload?.canRequest).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  test.each(["network", "server"])("a %s failure during a cooldown check retries the read and unlocks generation without another POST", async failure => {
    fetchMock.mockResolvedValueOnce(response(snapshot("failed", { canRequest: false, retryAt: new Date(now.getTime() + 300000).toISOString() })));
    if (failure === "network") fetchMock.mockRejectedValueOnce(new TypeError("connection lost"));
    else fetchMock.mockResolvedValueOnce(response({ error: "connection lost" }, 503));
    fetchMock.mockResolvedValueOnce(response(snapshot("failed")));
    const screen = mount(); await settle();
    await vi.advanceTimersByTimeAsync(300250);
    expect(screen.view.payload?.canRequest).toBe(false);
    expect(screen.view.error).toBe("connection lost");
    await vi.advanceTimersByTimeAsync(5000);
    expect(methods()).toEqual(["GET", "GET", "GET"]);
    expect(screen.view.payload?.canRequest).toBe(true);
    expect(screen.view.error).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a cooldown check rejected by authentication does not add transient-error retries", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot("failed", { canRequest: false, retryAt: new Date(now.getTime() + 300000).toISOString() })))
      .mockResolvedValueOnce(response({ error: "로그인이 필요해요." }, 401));
    const screen = mount(); await settle();
    await vi.advanceTimersByTimeAsync(360000);
    expect(methods()).toEqual(["GET", "GET"]);
    expect(screen.view.error).toBe("로그인이 필요해요.");
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([401, 403])("a processing status read rejected with %s stops polling until an explicit refresh", async status => {
    fetchMock.mockResolvedValueOnce(response(snapshot("processing")))
      .mockResolvedValueOnce(response({ error: "접근 권한을 확인해 주세요." }, status))
      .mockResolvedValueOnce(response(snapshot("ready")));
    const screen = mount(); await settle();
    await vi.advanceTimersByTimeAsync(60000);
    expect(methods()).toEqual(["GET", "GET"]);
    expect(screen.view.error).toBe("접근 권한을 확인해 주세요.");
    expect(vi.getTimerCount()).toBe(0);
    await screen.session.refresh();
    expect(screen.view.payload?.connection?.status).toBe("ready");
    expect(screen.view.error).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  test("an incomplete JSON cooldown response is retried until the pending status check succeeds", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot("failed", { canRequest: false, retryAt: new Date(now.getTime() + 300000).toISOString() })))
      .mockResolvedValueOnce(new Response('{"date":', { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(response(snapshot("failed")));
    const screen = mount(); await settle();
    await vi.advanceTimersByTimeAsync(300250);
    expect(screen.view.payload?.canRequest).toBe(false);
    expect(screen.view.error).toContain("선택한 날짜");
    await vi.advanceTimersByTimeAsync(5000);
    expect(methods()).toEqual(["GET", "GET", "GET"]);
    expect(screen.view.payload?.canRequest).toBe(true);
    expect(screen.view.error).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("cooldown recovery pauses while hidden and is cancelled on leaving", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot("failed", { canRequest: false, retryAt: new Date(now.getTime() + 300000).toISOString() })))
      .mockRejectedValue(new TypeError("connection lost"));
    const screen = mount(); await settle();
    await vi.advanceTimersByTimeAsync(300250);
    page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(methods()).toEqual(["GET", "GET"]);
    page.hidden = false; page.dispatchEvent(new Event("visibilitychange")); await settle();
    expect(methods()).toEqual(["GET", "GET", "GET"]);
    expect(vi.getTimerCount()).toBe(1);
    screen.session.dispose();
    await vi.advanceTimersByTimeAsync(60000);
    expect(methods()).toEqual(["GET", "GET", "GET"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a hidden tab pauses polling and reads once when it becomes visible", async () => {
    fetchMock.mockResolvedValue(response(snapshot("processing")));
    mount(); await settle();
    page.hidden = true; page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    page.hidden = false; page.dispatchEvent(new Event("visibilitychange")); await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(posts()).toHaveLength(0);
  });

  test("date change aborts and ignores a late previous response", async () => {
    const oldRead = deferred<Response>();
    fetchMock.mockImplementationOnce(() => oldRead.promise)
      .mockResolvedValueOnce(response(snapshot(null, { date: today })));
    const old = mount(); const signal = fetchMock.mock.calls[0][1]?.signal;
    old.session.dispose();
    const next = mount(today); await settle();
    oldRead.resolve(response(snapshot("ready"))); await settle();
    expect(signal?.aborted).toBe(true);
    expect(old.update).not.toHaveBeenCalled();
    expect(next.view.payload?.date).toBe(today);
  });

  test("leaving while fragment saving is pending never sends a POST after cleanup", async () => {
    const saving = deferred<void>();
    fetchMock.mockResolvedValueOnce(response(snapshot()));
    const screen = mount(date, () => saving.promise); await settle();
    const start = screen.session.start();
    screen.session.dispose();
    const calls = screen.update.mock.calls.length;
    saving.resolve(); await start;
    page.dispatchEvent(new Event("visibilitychange")); await settle();
    expect(posts()).toHaveLength(0);
    expect(screen.update).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("lost POST response checks status, never loops POST, and reuses the uncertain request id on explicit retry", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot()))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(response(snapshot("queued"), 202));
    const screen = mount(); await settle();
    await screen.session.start();
    expect(screen.view.error).toBe("connection lost");
    await vi.advanceTimersByTimeAsync(60000);
    expect(methods()).toEqual(["GET", "POST", "GET"]);
    await screen.session.start();
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(posts().map(([, options]) => JSON.parse(String(options?.body)).requestId)).toEqual([requestId, requestId]);
  });

  test("a failed status read after a lost POST response keeps checking the approved request", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot()))
      .mockRejectedValueOnce(new TypeError("POST response lost"))
      .mockRejectedValueOnce(new TypeError("GET response lost"))
      .mockResolvedValueOnce(response(snapshot("queued")))
      .mockResolvedValueOnce(response(snapshot("ready")));
    const screen = mount(); await settle();
    await screen.session.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.view.error).toBe("GET response lost");
    await vi.advanceTimersByTimeAsync(10000);
    expect(methods()).toEqual(["GET", "POST", "GET", "GET", "GET"]);
    expect(screen.view.payload?.connection?.status).toBe("ready");
    expect(screen.view.error).toBeNull();
    expect(posts()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a failed fragment save shows the error and never generates", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot()));
    const screen = mount(date, async () => { throw new Error("저장 실패"); }); await settle();
    await screen.session.start(); await vi.advanceTimersByTimeAsync(60000);
    expect(methods()).toEqual(["GET"]);
    expect(screen.view.error).toBe("저장 실패");
    expect(screen.view.posting).toBe(false);
  });

  test("a response for a different diary cannot populate this screen", async () => {
    fetchMock.mockResolvedValueOnce(response(snapshot("ready", { date: today })));
    const screen = mount(); await settle();
    expect(screen.view.payload).toBeNull();
    expect(screen.view.error).toContain("선택한 날짜");
  });

  test.each([{ consent: false }, { enabled: false }, { hasEntries: false }])("server permission %j blocks starting", async restriction => {
    fetchMock.mockResolvedValueOnce(response(snapshot(null, restriction)));
    const screen = mount(); await settle(); await screen.session.start();
    expect(posts()).toHaveLength(0);
  });
});
