import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { aiConfigured, illustrate, summarize } from "../src/server/core/ai";

const fetchMock = vi.fn<typeof fetch>();
const scene = { title: "산책", summary: "공원을 걸었다.", image_prompt: "A quiet watercolor park", scene: "park", tags: ["산책"] };
const entries = [{ content: "공원을 걸었다.", created_at: "2026-11-04T01:00:00Z" }];
const safeSummaryError = "장면 요약을 완성하지 못했어요. 잠시 뒤 다시 시도해 주세요.";

function successfulSummary() {
  return { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(scene) }] }] };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("Unexpected mocked API call"));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENAI_API_KEY", " fake-test-key ");
  vi.stubEnv("OPENAI_TEXT_MODEL", " gpt-6-luna ");
  vi.stubEnv("OPENAI_IMAGE_MODEL", " gpt-image-2.5-flare ");
  vi.stubEnv("SUPABASE_SECRET_KEY", " fake-server-key ");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("AI connection settings", () => {
  test.each(["OPENAI_API_KEY", "OPENAI_TEXT_MODEL", "OPENAI_IMAGE_MODEL", "SUPABASE_SECRET_KEY"])("rejects whitespace-only %s without making a request", name => {
    vi.stubEnv(name, " \t ");
    expect(aiConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("accepts trimmed settings and a legacy server key when the new key is blank", () => {
    expect(aiConfigured()).toBe(true);
    vi.stubEnv("SUPABASE_SECRET_KEY", " ");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", " legacy-test-server-key ");
    expect(aiConfigured()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AI response handling", () => {
  test("uses trimmed Luna settings and disables reasoning while preserving strict JSON output", async () => {
    fetchMock.mockResolvedValue(Response.json(successfulSummary()));
    await expect(summarize(entries, "watercolor")).resolves.toEqual(scene);
    const [url, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options!.body as string);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options!.headers).toMatchObject({ Authorization: "Bearer fake-test-key" });
    expect(body).toMatchObject({ model: "gpt-6-luna", reasoning: { effort: "none" }, store: false, text: { format: { type: "json_schema", strict: true } } });
  });

  test("leaves another text model's reasoning settings unchanged", async () => {
    vi.stubEnv("OPENAI_TEXT_MODEL", " gpt-6.1-sol ");
    fetchMock.mockResolvedValue(Response.json(successfulSummary()));
    await summarize(entries, "watercolor");
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.model).toBe("gpt-6.1-sol");
    expect(body).not.toHaveProperty("reasoning");
  });

  test("rejects an incomplete response with a fixed error before parsing truncated JSON", async () => {
    fetchMock.mockResolvedValue(Response.json({ status: "incomplete", output: [{ content: [{ type: "output_text", text: "private truncated response {" }] }] }));
    await expect(summarize(entries, "watercolor")).rejects.toThrow(safeSummaryError);
    expect(console.error).not.toHaveBeenCalled();
  });

  test("rejects a refusal even when valid output text accompanies it, without exposing refusal text", async () => {
    const response = successfulSummary();
    response.output[0].content.push({ type: "refusal", text: "private provider refusal" });
    fetchMock.mockResolvedValue(Response.json(response));
    await expect(summarize(entries, "watercolor")).rejects.toThrow(safeSummaryError);
    expect(console.error).not.toHaveBeenCalled();
  });

  test("logs only safe request metadata for a rejected API call", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: "private provider response" } }, { status: 401, headers: { "x-request-id": "test-request-id" } }));
    await expect(summarize(entries, "watercolor")).rejects.toThrow("그림을 완성하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    expect(console.error).toHaveBeenCalledExactlyOnceWith("AI request failed", { endpoint: "responses", status: 401, requestId: "test-request-id" });
  });

  test("uses the trimmed image model and decodes PNG output", async () => {
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    fetchMock.mockResolvedValue(Response.json({ data: [{ b64_json: png.toString("base64") }] }));
    await expect(illustrate(scene.image_prompt)).resolves.toEqual(png);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(options!.headers).toMatchObject({ Authorization: "Bearer fake-test-key" });
    expect(JSON.parse(options!.body as string)).toMatchObject({ model: "gpt-image-2.5-flare", n: 1, size: "1024x1024", quality: "low", output_format: "png" });
  });
});
