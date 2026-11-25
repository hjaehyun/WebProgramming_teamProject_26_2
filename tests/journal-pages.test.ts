import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn(), params: vi.fn(), search: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store, byTime: (a: { at: string }, b: { at: string }) => a.at.localeCompare(b.at), sortedArtworks: (db: { artworks: Record<string, unknown> }) => Object.values(db.artworks) }));
vi.mock("next/navigation", () => ({ useParams: mocks.params, useSearchParams: mocks.search, useRouter: () => ({ replace: mocks.replace, push: mocks.push }), usePathname: () => "/gallery" }));
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
const clicks = new Map<string, () => Promise<void>>();
function state(overrides: Record<string, unknown> = {}) {
  return { ready: true, authed: true, error: null, db: {
    profile: { nick: "기록", style: "water" }, artworks: {}, drafts: {}, capabilities: { music: false, weather: false },
    exhibition: { dates: [] }, ...overrides,
  } };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-25T03:00:00Z"));
  clicks.clear();
  vi.stubGlobal("React", { ...React, createElement: (type: React.ElementType, props: Record<string, unknown> | null, ...children: React.ReactNode[]) => {
    if (typeof props?.["aria-label"] === "string" && typeof props.onClick === "function") clicks.set(props["aria-label"], props.onClick as () => Promise<void>);
    return createElement(type, props, ...children);
  } });
  mocks.params.mockReturnValue({ date });
  mocks.search.mockReturnValue(new URLSearchParams("month=2026-11"));
  mocks.store.mockReturnValue(state());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("journal date pages without an artwork", () => {
  function writingStore() {
    const journalComposers: Record<string, Record<string, unknown>> = { [date]: { draft: "아직 입력 중인 글" } };
    return { ...state(), journalComposers, isCurrentSession: () => true,
      setJournalComposer: vi.fn((day: string, patch: Record<string, unknown> | null) => {
        if (patch === null) delete journalComposers[day];
        else journalComposers[day] = { ...journalComposers[day], ...patch };
      }),
      addEntry: vi.fn(() => entry), editEntry: vi.fn(),
      flushEntries: vi.fn(async () => {}), refresh: vi.fn(async () => ({ drafts: {}, artworks: {} })),
    };
  }

  test("cancelling a day-change confirmation leaves the draft and does not write or navigate", async () => {
    const store = writingStore(); mocks.store.mockReturnValue(store); vi.stubGlobal("confirm", vi.fn(() => false));
    renderToStaticMarkup(createElement(DetailPage));
    await clicks.get("전날 기록")!();
    expect(store.journalComposers[date].draft).toBe("아직 입력 중인 글");
    expect(store.addEntry).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  test("day navigation and clearing input wait for a confirmed save", async () => {
    const store = writingStore();
    let finish!: () => void;
    store.flushEntries.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    mocks.store.mockReturnValue(store); vi.stubGlobal("confirm", vi.fn(() => true));
    renderToStaticMarkup(createElement(DetailPage));
    const changing = clicks.get("전날 기록")!();
    expect(store.journalComposers[date].draft).toBe("아직 입력 중인 글");
    expect(mocks.replace).not.toHaveBeenCalled();
    finish(); await changing;
    expect(store.journalComposers[date]).toBeUndefined();
    expect(mocks.replace).toHaveBeenCalledWith("/gallery/2026-11-23");
  });

  test("failed saving keeps both the selected day and text available for retry", async () => {
    const store = writingStore(); store.flushEntries.mockRejectedValue(new Error("연결을 확인해 주세요"));
    mocks.store.mockReturnValue(store); vi.stubGlobal("confirm", vi.fn(() => true));
    renderToStaticMarkup(createElement(DetailPage));
    await clicks.get("다음날 기록")!();
    expect(store.journalComposers[date].draft).toBe("아직 입력 중인 글");
    expect(store.journalComposers[date].saving).toBe(false);
    expect(store.journalComposers[date].note).toBe("연결을 확인해 주세요");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  test("returning to a date restores its own unsaved input without showing another day's text", () => {
    mocks.store.mockReturnValue({ ...state(), journalComposers: {
      [date]: { draft: "아직 저장하지 않은 이날의 기억", editingId: null },
      "2026-11-23": { draft: "다른 날짜의 개인 글", editingId: null },
    } });
    const html = renderToStaticMarkup(createElement(DetailPage));
    expect(html).toContain('value="아직 저장하지 않은 이날의 기억"');
    expect(html).toContain("아직 저장하지 않은 글이에요");
    expect(html).not.toContain("다른 날짜의 개인 글");
  });

  test("a save in progress retains the input, locks repeated submit and day navigation, and does not claim completion", () => {
    mocks.store.mockReturnValue({ ...state(), journalComposers: { [date]: { draft: "저장 중인 글", saving: true } } });
    const html = renderToStaticMarkup(createElement(DetailPage));
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="저장 중인 글"/);
    expect(html).toMatch(/<button[^>]*aria-label="전날 기록"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="조각 더하기"/);
    expect(html).toContain("조각을 저장하고 있어요");
    expect(html).not.toContain("저장 완료");
  });

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
