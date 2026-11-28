import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store }));
vi.mock("../src/components/ui", () => ({ Screen: ({ children }: React.PropsWithChildren) => children, TopBar: () => null, IconNext: () => null, BottomNav: () => null }));
vi.mock("../src/components/Art", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => createElement("a", { ...props, href }, children) }));
import MyPage from "../src/app/me/page";

const emptyDetails = { gender: "unspecified", ageRange: "unspecified", occupation: "", appearance: "" };

function profileShortcut(profile: Record<string, unknown>) {
  mocks.store.mockReturnValue({ db: { profile: { nick: "나", style: "water", ...profile }, artworks: {}, drafts: {}, exhibition: { isPublic: false, dates: [] } }, signOut: vi.fn() });
  const html = renderToStaticMarkup(createElement(MyPage));
  const shortcut = html.match(/<a\b[^>]*href="\/profile\?step=details"[^>]*>[\s\S]*?<\/a>/)?.[0];
  expect(shortcut).toBeDefined();
  return shortcut!;
}

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("my page illustration profile status", () => {
  test.each([
    { consent: true },
    { consent: true, artProfileEnabled: true, artProfile: emptyDetails },
    { consent: false, artProfileEnabled: false, artProfile: { ...emptyDetails, appearance: "  " } },
  ])("legacy and empty details show that information has not been entered", profile => {
    expect(profileShortcut(profile)).toContain("입력 전");
  });

  test.each([
    { consent: true, artProfileEnabled: false },
    { consent: false, artProfileEnabled: true },
  ])("saved details show reflection off when either required choice is off", choices => {
    expect(profileShortcut({ ...choices, artProfile: { ...emptyDetails, appearance: "둥근 안경" } })).toContain("반영 꺼짐");
  });

  test.each([
    { gender: "neutral" }, { ageRange: "30s" }, { occupation: "개발자" }, { appearance: "둥근 안경" },
  ])("any entered detail with both choices on applies to new drawings", detail => {
    const shortcut = profileShortcut({ consent: true, artProfileEnabled: true, artProfile: { ...emptyDetails, ...detail } });
    expect(shortcut).toContain("새 그림에 반영");
    expect(shortcut).not.toContain("그림에 반영 중");
  });
});
