import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useStore: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.useStore }));
vi.mock("../src/components/ui", () => ({ IconBack: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => new URLSearchParams("step=style"),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => createElement("a", { ...props, href }, children),
}));
import ProfilePage from "../src/app/profile/page";

function state(overrides: Record<string, unknown> = {}) {
  return { db: { profile: null }, ready: false, authed: false, error: null, refresh: vi.fn(), setProfile: vi.fn(), signOut: vi.fn(), ...overrides };
}
function render(store: ReturnType<typeof state>) {
  mocks.useStore.mockReturnValue(store);
  return renderToStaticMarkup(createElement(ProfilePage));
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("profile load boundary", () => {
  test("does not expose an editable profile before the authenticated dashboard is ready", () => {
    const html = render(state());
    expect(html).toContain("불러오는 중…");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("다음</button>");
  });

  test("a failed first dashboard offers retry instead of a blank profile that can be saved", () => {
    // refresh sets ready=true with an empty fallback after a non-authentication
    // error. That fallback is not evidence that onboarding is required.
    const failed = state({ ready: true, error: "계정 정보를 불러오지 못했어요." });
    const html = render(failed);
    expect(html).toContain('role="alert"');
    expect(html).toContain("계정 정보를 불러오지 못했어요.");
    expect(html).toContain("다시 불러오기");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("반가워요!");
    expect(failed.setProfile).not.toHaveBeenCalled();
  });

  test("recovery on the same component preserves the ability to prefill the stored profile", () => {
    const failed = state({ ready: true, error: "일시적인 연결 오류" });
    const recovered = state({ ready: true, authed: true, db: { profile: { nick: "기존 이름", style: "crayon", consent: true } } });
    expect(render(failed)).not.toContain("<input");
    // Advance the mocked dashboard with a real React render-phase update. The
    // Profile instance retains its hooks between the error and recovered renders,
    // so prematurely setting `prefilled` on the error render breaks this test.
    mocks.useStore.mockImplementation(function useRecoveringStore() {
      const [loaded, setLoaded] = React.useState(false);
      if (!loaded) { setLoaded(true); return failed; }
      return recovered;
    });
    const html = renderToStaticMarkup(createElement(ProfilePage));

    expect(html).toContain("기존 이름");
    expect(html).toContain("어떤 그림체로 바꿀까요?");
    expect(html).toContain("크레파스");
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toContain("저장하기");
    expect(html).not.toContain("반가워요!");
    expect(html).not.toContain("다시 불러오기");
    expect(recovered.setProfile).not.toHaveBeenCalled();
  });

  test("a successfully loaded account without a profile can still start onboarding", () => {
    const html = render(state({ ready: true, authed: true }));
    expect(html).toContain("반가워요!");
    expect(html).toContain("<input");
    expect(html).toContain("다음</button>");
    expect(html).not.toContain("다시 불러오기");
  });
});
