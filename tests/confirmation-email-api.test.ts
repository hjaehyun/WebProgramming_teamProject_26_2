import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mock = vi.hoisted(() => ({ signUp: vi.fn(), resend: vi.fn(), userClient: vi.fn(), configured: vi.fn(), adminClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/server/core/supabase/server", () => ({
  configured: mock.configured, userClient: mock.userClient, adminClient: mock.adminClient, statelessClient: vi.fn(),
}));
vi.mock("../src/server/recovery", () => ({ clearRecovery: vi.fn(), requireRecovery: vi.fn() }));
import { auth } from "../src/server/auth-handlers";
import { POST } from "../src/app/api/auth/resend-confirmation/route";

const origin = "https://haru.example";
function request(path: string, input: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/auth/${path}`, { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(input) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_URL", origin);
  mock.configured.mockReturnValue(true);
  mock.userClient.mockResolvedValue({ auth: { signUp: mock.signUp, resend: mock.resend } });
  mock.signUp.mockResolvedValue({ data: { session: null }, error: null });
  mock.resend.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("signup confirmation email requests", () => {
  test("signup distinguishes provider cooldown from an unknown delivery failure", async () => {
    mock.signUp.mockResolvedValueOnce({ error: { status: 429, code: "over_email_send_rate_limit", message: "private provider data" } });
    const limited = await auth(request("signup", { email: "new@example.com", password: "example-password" }), "signup");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(await limited.json()).toMatchObject({ retryAfterSeconds: 60, error: expect.stringContaining("1분") });
    mock.signUp.mockResolvedValueOnce({ error: { status: 500, message: "SMTP private credentials" } });
    const failed = await auth(request("signup", { email: "new@example.com", password: "example-password" }), "signup");
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("SMTP");
  });

  test("resend uses the cookie-aware user client and the fixed same-site callback, without creating an account", async () => {
    const response = await POST(request("resend-confirmation", { email: " new@example.com ", redirectTo: "https://evil.example" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mock.resend).toHaveBeenCalledWith({ type: "signup", email: "new@example.com", options: { emailRedirectTo: `${origin}/auth/callback` } });
    expect(mock.signUp).not.toHaveBeenCalled(); expect(mock.adminClient).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ message: expect.stringContaining("인증"), retryAfterSeconds: 60 });
  });

  test.each(["pending@example.com", "missing@example.com", "confirmed@example.com"])("does not disclose provider-success account state for %s", async email => {
    const response = await POST(request("resend-confirmation", { email }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "인증이 필요한 가입 요청이라면 메일을 다시 요청했어요. 스팸함과 입력한 주소를 확인해 주세요. 이미 인증했다면 로그인해 주세요.", retryAfterSeconds: 60 });
    expect(mock.adminClient).not.toHaveBeenCalled();
  });

  test.each([{ status: 429 }, { status: 400, code: "over_email_send_rate_limit" }, { status: 400, code: "over_request_rate_limit" }])("resend cooldown error stays retryable: %j", async error => {
    mock.resend.mockResolvedValue({ error });
    const response = await POST(request("resend-confirmation", { email: "new@example.com" }));
    expect(response.status).toBe(429); expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("기다린"), retryAfterSeconds: 60 });
  });

  test("provider/configuration failure is not reported as a successful mail request", async () => {
    mock.resend.mockResolvedValue({ error: { status: 400, code: "email_provider_disabled", message: "private provider configuration" } });
    const response = await POST(request("resend-confirmation", { email: "new@example.com" }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });

  test("invalid emails, cross-origin requests and missing configuration never call the provider", async () => {
    expect((await POST(request("resend-confirmation", { email: "wrong" }))).status).toBe(400);
    expect((await POST(request("resend-confirmation", { email: "new@example.com" }, "https://evil.example"))).status).toBe(403);
    mock.configured.mockReturnValue(false);
    expect((await POST(request("resend-confirmation", { email: "new@example.com" }))).status).toBe(503);
    expect(mock.resend).not.toHaveBeenCalled();
  });
});
