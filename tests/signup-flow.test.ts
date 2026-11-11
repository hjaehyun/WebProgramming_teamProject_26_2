import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { StoreProvider, useStore } from "../src/lib/store";
import { finishAuthentication } from "../src/lib/auth-flow";

interface SignupStore {
  signUp(email: string, password: string): Promise<{ confirmationRequired: boolean; profile?: unknown }>;
  signIn(email: string, password: string): Promise<{ profile?: unknown }>;
}

// Exercise the real provider callbacks without mounting effects or adding a DOM
// harness. The initial /api/me effect is unrelated to a submitted signup.
function signupStore(): SignupStore {
  let captured!: SignupStore;
  function Capture() { captured = useStore(); return null; }
  renderToStaticMarkup(createElement(StoreProvider, null, createElement(Capture)));
  return captured;
}

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

// Vitest's existing JSX transform uses the classic runtime; Next supplies the
// automatic runtime in the app. Keep that test-only difference out of config.
beforeEach(() => { vi.stubGlobal("React", React); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("signup confirmation and authenticated navigation", () => {
  test("a confirmation email is successful without fetching a session or navigating", async () => {
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => response({ ok: true, confirm: true }));
    vi.stubGlobal("fetch", fetcher);
    const onConfirmation = vi.fn();
    const navigate = vi.fn();
    const request = signupStore().signUp("new@example.com", "example-password");

    await finishAuthentication(request, onConfirmation, navigate);

    await expect(request).resolves.toEqual({ confirmationRequired: true });
    expect(onConfirmation).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/auth/signup");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ email: "new@example.com", password: "example-password" });
  });

  test.each([
    { profile: { nick: "하루" }, destination: "/today" },
    { profile: null, destination: "/profile" },
  ])("an immediate session waits for the dashboard before navigating to $destination", async ({ profile, destination }) => {
    const dashboard = deferred<Response>();
    const dashboardStarted = deferred<void>();
    const fetcher = vi.fn(async (url: string) => {
      if (url === "/api/auth/signup") return response({ ok: true, confirm: false });
      if (url === "/api/me") { dashboardStarted.resolve(); return dashboard.promise; }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const onConfirmation = vi.fn();
    const navigate = vi.fn();
    const request = signupStore().signUp("new@example.com", "example-password");
    const submitted = finishAuthentication(request, onConfirmation, navigate);

    await dashboardStarted.promise;
    expect(navigate).not.toHaveBeenCalled();
    expect(onConfirmation).not.toHaveBeenCalled();
    dashboard.resolve(response({ profile }));
    await submitted;

    await expect(request).resolves.toEqual({ profile, confirmationRequired: false });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(destination);
    expect(onConfirmation).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/auth/signup", "/api/me"]);
  });

  test("a rejected signup shows neither confirmation success nor authenticated navigation", async () => {
    const fetcher = vi.fn(async () => response({ error: "메일 발송 설정을 확인해 주세요." }, 503));
    vi.stubGlobal("fetch", fetcher);
    const onConfirmation = vi.fn();
    const navigate = vi.fn();

    await expect(finishAuthentication(
      signupStore().signUp("new@example.com", "example-password"), onConfirmation, navigate,
    )).rejects.toThrow("메일 발송 설정을 확인해 주세요.");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onConfirmation).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("dashboard failure after signup remains a failure and never navigates", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ ok: true, confirm: false }))
      .mockResolvedValueOnce(response({ error: "계정 정보를 불러오지 못했어요." }, 503));
    vi.stubGlobal("fetch", fetcher);
    const onConfirmation = vi.fn();
    const navigate = vi.fn();

    await expect(finishAuthentication(
      signupStore().signUp("new@example.com", "example-password"), onConfirmation, navigate,
    )).rejects.toThrow("계정 정보를 불러오지 못했어요.");

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/auth/signup", "/api/me"]);
    expect(onConfirmation).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("ordinary sign-in still navigates when its dashboard has no confirmation field", async () => {
    const profile = { nick: "하루" };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response({ profile }));
    vi.stubGlobal("fetch", fetcher);
    const onConfirmation = vi.fn();
    const navigate = vi.fn();
    const request = signupStore().signIn("existing@example.com", "example-password");

    await finishAuthentication(request, onConfirmation, navigate);

    await expect(request).resolves.toEqual({ profile });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/auth/login", "/api/me"]);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/today");
    expect(onConfirmation).not.toHaveBeenCalled();
  });
});
