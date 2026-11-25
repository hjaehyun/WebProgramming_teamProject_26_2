import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { NewsImage } from "../src/components/news-image";

beforeAll(() => vi.stubGlobal("React", React));
afterEach(() => vi.clearAllMocks());
afterAll(() => vi.unstubAllGlobals());
const render = (overrides = {}) => renderToStaticMarkup(createElement(NewsImage, {
  url: "https://images.example/stored.png", imageError: false, alt: "저장된 그림의 설명", label: "뉴스 그림",
  onReload: vi.fn(), boxClassName: "image-box", errorClassName: "image-error", ...overrides,
}));

test("a stored image offers an accessible enlargement dialog without preloading a second image", () => {
  const html = render();
  expect(html).toContain('aria-label="뉴스 그림 크게 보기"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toMatch(/<dialog[^>]*aria-labelledby=/);
  expect(html).not.toMatch(/<dialog[^>]*open/);
  expect(html).toContain('aria-label="확대 화면 닫기"');
  expect(html.match(/<img /g)).toHaveLength(1);
  expect(html).toContain('src="https://images.example/stored.png"');
});

test.each([{ url: null }, { imageError: true }])("unavailable images offer reload without an enlargement or sample image: %j", overrides => {
  const html = render(overrides);
  expect(html).toContain("다시 불러오기");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<dialog");
  expect(html).not.toContain("크게 보기");
});
