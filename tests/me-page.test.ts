import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/me" }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren) => createElement("a", props, children) }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store }));
vi.mock("../src/components/Art", () => ({ default: () => null }));
vi.mock("../src/components/ui", () => ({
  Screen: ({ children }: React.PropsWithChildren) => children,
  TopBar: () => null,
  IconNext: () => null,
  BottomNav: () => createElement("nav", { "data-testid": "bottom-nav" }),
}));
let MyPage: typeof import("../src/app/me/page").default;
beforeAll(async () => {
  vi.stubGlobal("React", React);
  MyPage = (await import("../src/app/me/page")).default;
});

const db = {
  account: { kind: "email", provider: "email", email: "writer@example.test", createdAt: "2026-11-01T00:00:00Z" },
  profile: { nick: "작가", style: "water", consent: true, artProfileEnabled: false, artProfile: { gender: "unspecified", ageRange: "unspecified", occupation: "", appearance: "" } },
  artworks: {}, drafts: {}, exhibition: { id: "", title: "나의 하루조각", desc: "", isPublic: false, dates: [] }, deletionPending: false,
};

describe("my page", () => {
  test("keeps the main bottom navigation, like the other signed-in screens", () => {
    mocks.store.mockReturnValue({ db, signOut: vi.fn(), changePassword: vi.fn(), deleteAccount: vi.fn() });
    const html = renderToStaticMarkup(createElement(MyPage));
    expect(html).toContain('data-testid="bottom-nav"');
  });
});
