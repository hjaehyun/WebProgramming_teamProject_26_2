import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ path: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mocks.path, useRouter: () => ({}) }));
vi.mock("../src/lib/store", () => ({ useStore: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren) => createElement("a", props, children) }));
let BottomNav: typeof import("../src/components/ui").BottomNav;
beforeAll(async () => {
  vi.stubGlobal("React", React);
  BottomNav = (await import("../src/components/ui")).BottomNav;
});
afterEach(() => vi.clearAllMocks());

describe("main navigation location", () => {
  test.each([
    ["/today", "오늘"],
    ["/gallery/2026-11-25", "갤러리"],
    ["/exhibition/pick", "전시회"],
    ["/cartoon", "하루세상"],
    ["/connection", "하루세상"],
  ])("%s selects exactly its parent tab", (path, label) => {
    mocks.path.mockReturnValue(path);
    const html = renderToStaticMarkup(createElement(BottomNav));
    const active = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(active).toHaveLength(1);
    expect(active[0][1]).toContain(label);
    expect(html.match(/<a\b/g)).toHaveLength(4);
  });

  test("an unrelated route does not borrow another tab's selection", () => {
    mocks.path.mockReturnValue("/connection-other");
    expect(renderToStaticMarkup(createElement(BottomNav))).not.toContain('aria-current="page"');
  });
});
