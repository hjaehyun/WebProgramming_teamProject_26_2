import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateArtwork, writeCuration } from "../src/lib/ai";

const date = "2026-11-11";
const requestId = "00000000-0000-4000-8000-000000000001";
function artwork(status = "ready", extra: Record<string, unknown> = {}) {
  return { date, status, requestId, imageUrl: status === "ready" ? "/picture.png" : null, ...extra };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("crypto", { randomUUID: () => requestId });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("server-owned image generation client", () => {
  test("sends only date, redraw and one request ID; queued remains queued", async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => response({ artwork: artwork("queued") }, 202));
    vi.stubGlobal("fetch", fetcher);
    const update = vi.fn();
    const result = await generateArtwork(date, false, update);
    expect(result.status).toBe("queued");
    expect(update).toHaveBeenCalledWith(artwork("queued"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ date, redraw: false, requestId });
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([400, 401, 403, 409, 429])("HTTP %s never becomes success from an older ready picture", async status => {
    const fetcher = vi.fn(async () => response({ error: "요청 거부" }, status));
    vi.stubGlobal("fetch", fetcher);
    const update = vi.fn();
    await expect(generateArtwork(date, true, update)).rejects.toThrow("요청 거부");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  test("a lost response can recover this request's completed result without resubmitting", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response({ artwork: artwork() }));
    vi.stubGlobal("fetch", fetcher);
    const update = vi.fn();
    await expect(generateArtwork(date, true, update)).resolves.toMatchObject({ status: "ready", requestId });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  test("a lost response does not accept an unrelated previous ready picture", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response({ artwork: artwork("ready", { requestId: "old-request" }) }));
    vi.stubGlobal("fetch", fetcher);
    const update = vi.fn();
    await expect(generateArtwork(date, true, update)).rejects.toThrow("Failed to fetch");
    expect(update).not.toHaveBeenCalled();
  });

  test("an ambiguous 503 can recover this request's processing state without fake completion", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ error: "연결을 확인해 주세요" }, 503))
      .mockResolvedValueOnce(response({ artwork: artwork("processing") })));
    const update = vi.fn();
    const result = await generateArtwork(date, false, update);
    expect(result.status).toBe("processing");
    expect(update).toHaveBeenLastCalledWith(artwork("processing"));
  });

  test("a recovered failed job is displayed and rejects instead of reporting success", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(response({ artwork: artwork("failed", { error: "생성 실패" }) })));
    const update = vi.fn();
    await expect(generateArtwork(date, false, update)).rejects.toThrow("생성 실패");
    expect(update).toHaveBeenLastCalledWith(artwork("failed", { error: "생성 실패" }));
  });

  test("a slow poll cannot overwrite the final ready POST result", async () => {
    const post = deferred<Response>();
    const poll = deferred<Response>();
    const fetcher = vi.fn((_url, options) => options.method === "POST" ? post.promise : poll.promise);
    vi.stubGlobal("fetch", fetcher);
    const update = vi.fn();
    const generation = generateArtwork(date, false, update);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    post.resolve(response({ artwork: artwork("ready") }));
    await generation;
    poll.resolve(response({ artwork: artwork("queued") }));
    await vi.advanceTimersByTimeAsync(10000);
    expect(update.mock.calls.map(([a]) => a.status)).toEqual(["ready"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("polling ignores an old request and publishes this request only", async () => {
    const post = deferred<Response>();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => post.promise)
      .mockResolvedValueOnce(response({ artwork: artwork("ready", { requestId: "old-request" }) }))
      .mockResolvedValueOnce(response({ artwork: artwork("processing") }));
    vi.stubGlobal("fetch", fetcher);
    const update = vi.fn();
    const generation = generateArtwork(date, true, update);
    await vi.advanceTimersByTimeAsync(2000);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(update.mock.calls.map(([a]) => a.status)).toEqual(["processing"]);
    post.resolve(response({ artwork: artwork("ready") }));
    await generation;
    expect(update.mock.calls.map(([a]) => a.status)).toEqual(["processing", "ready"]);
  });

  test("invalid success payload is not accepted as a generated image", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ artwork: artwork("ready", { date: "2026-11-10" }) })));
    const update = vi.fn();
    await expect(generateArtwork(date, false, update)).rejects.toThrow("그림 상태");
    expect(update).not.toHaveBeenCalled();
  });

  test("curation passes dates only, never client-authored summaries or prompts", async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => response({ headline: "하루", body: "기록" }));
    vi.stubGlobal("fetch", fetcher);
    await writeCuration([{ date, summary: "private text", tags: ["private"] }], { top: [] }, "이번 주");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ dates: [date] });
  });
});
