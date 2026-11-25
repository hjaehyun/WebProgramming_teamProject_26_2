import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn(), params: vi.fn(), search: vi.fn(), replace: vi.fn() }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store, byTime: (a: { at: string }, b: { at: string }) => a.at.localeCompare(b.at), sortedArtworks: (db: { artworks: Record<string, unknown> }) => Object.values(db.artworks) }));
vi.mock("next/navigation", () => ({ useParams: mocks.params, useSearchParams: mocks.search, useRouter: () => ({ replace: mocks.replace }), usePathname: () => "/gallery" }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => createElement("a", { ...props, href }, children) }));
let GalleryPage: typeof import("../src/app/gallery/page").default;
let DetailPage: typeof import("../src/app/gallery/[date]/page").default;
beforeAll(async () => {
  // Shared navigation icons contain JSX at module scope; initialize the classic
  // JSX runtime before loading the real pages in this Node test environment.
  vi.stubGlobal("React", React);
  GalleryPage = (await import("../src/app/gallery/page")).default;
  DetailPage = (await import("../src/app/gallery/[date]/page")).default;
});

const date = "2026-11-24";
const entry = { id: "entry-1", text: "늦게 남기는 어제의 산책", at: "2026-11-25T01:00:00Z", weather: null };
function state(overrides: Record<string, unknown> = {}) {
  return { ready: true, authed: true, error: null, db: {
    profile: { nick: "기록", style: "water" }, artworks: {}, drafts: {}, capabilities: { music: false, weather: false },
    exhibition: { dates: [] }, ...overrides,
  } };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-25T03:00:00Z"));
  vi.stubGlobal("React", React);
  mocks.params.mockReturnValue({ date });
  mocks.search.mockReturnValue(new URLSearchParams("month=2026-11"));
  mocks.store.mockReturnValue(state());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("journal date pages without an artwork", () => {
  test("an empty past day has an editor, a disabled first-drawing button, and its month back link", () => {
    const html = renderToStaticMarkup(createElement(DetailPage));
    expect(html).toContain('aria-label="이날의 조각 더하기"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>이날의 그림 그리기<\/button>/);
    expect(html).toContain('href="/gallery?month=2026-11"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("오늘의 노래");
  });

  test("a past draft is shown and can start its first drawing", () => {
    mocks.store.mockReturnValue(state({ drafts: { [date]: [entry] } }));
    const html = renderToStaticMarkup(createElement(DetailPage));
    expect(html).toContain(entry.text);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>이날의 그림 그리기<\/button>/);
    expect(html).toContain("11/25<br/>더함");
    expect(html).toContain('aria-label="전날 기록"');
    expect(html).toContain('aria-label="다음날 기록"');
  });

  test.each(["invalid", "2026-02-30", "0000-01-01", "2026-11-26"])("direct date %s never exposes writing or generation", value => {
    mocks.params.mockReturnValue({ date: value });
    const html = renderToStaticMarkup(createElement(DetailPage));
    expect(html).toContain("달력으로 돌아가기");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("이날의 그림 그리기");
  });

  test("processing days keep their entry editor locked", () => {
    mocks.store.mockReturnValue(state({ artworks: { [date]: { date, status: "processing", phase: "drawing", style: "water", frame: "basic", entries: [entry], tags: [], summary: "산책", scene: "park", canRetry: false } } }));
    const html = renderToStaticMarkup(createElement(DetailPage));
    expect(html).toContain(entry.text);
    expect(html).not.toContain('aria-label="이날의 조각 더하기"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>다시 그리기<\/button>/);
  });

  test("the calendar exposes empty past dates, labels drafts and leaves future dates unlinked", () => {
    mocks.store.mockReturnValue(state({ drafts: { [date]: [entry] } }));
    const html = renderToStaticMarkup(createElement(GalleryPage));
    expect(html).toContain('href="/gallery/2026-11-23"');
    expect(html).toContain('href="/gallery/2026-11-24"');
    expect(html).toContain("조각글 1개 이어 쓰기");
    expect(html).not.toContain('href="/gallery/2026-11-26"');
    expect(html).toContain('type="month"');
    expect(html).toContain('max="2026-11"');
  });

  test("a query-selected older month is shown even when the account has no pictures", () => {
    mocks.search.mockReturnValue(new URLSearchParams("month=1982-03"));
    const html = renderToStaticMarkup(createElement(GalleryPage));
    expect(html).toContain('value="1982-03"');
    expect(html).toContain('href="/gallery/1982-03-01"');
    expect(html).toMatch(/<button[^>]*aria-label="이전 달"(?![^>]*disabled)[^>]*>/);
  });
});
