import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn(), search: vi.fn(), hook: vi.fn(), start: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store }));
vi.mock("../src/lib/connection-client", () => ({ useConnection: mocks.hook }));
vi.mock("next/navigation", () => ({ useSearchParams: mocks.search, useRouter: () => ({ replace: mocks.replace }), usePathname: () => "/connection" }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => createElement("a", { ...props, href }, children) }));
let ConnectionPage: typeof import("../src/app/connection/page").default;
beforeAll(async () => { vi.stubGlobal("React", React); ConnectionPage = (await import("../src/app/connection/page")).default; });
const date = "2026-11-04", today = "2026-11-25";
const entry = { id: "entry-1", text: "코딩 공부하다가 늦게 잠들었다", at: "2026-11-04T10:00:00Z" };
function result(overrides: Record<string, unknown> = {}) {
  return {
    id: "connection-1", date, status: "ready", stage: "drawing", topics: [{ code: "coding", label: "소프트웨어 개발" }],
    headline: "새 개발 도구가 바꾸는 코딩", summary: "보도 내용을 요약했어요.", connectionReason: "이날의 코딩 공부가 개발 도구 소식과 이어져요.",
    caption: "코딩 책 옆으로 이어진 뉴스의 길을 그렸어요.", imageUrl: "https://images.example/news.png", imageError: false,
    sources: [{ title: "개발 도구 원문 보도", url: "https://news.example/article", publisher: "뉴스 예시", publishedAt: "2026-11-04T01:00:00Z" }],
    selectedAt: "2026-11-25T10:00:00Z", newsFrom: "2026-10-04T00:00:00+09:00", newsTo: "2026-11-04T23:59:59.999+09:00", attempts: 1, maxAttempts: 3, sourceChanged: false, rangeChanged: false, ...overrides,
  };
}
function payload(overrides: Record<string, unknown> = {}) {
  return { date, today, dates: [], newsFrom: "2026-10-04T00:00:00+09:00", newsTo: "2026-11-04T23:59:59.999+09:00", enabled: true, consent: true, hasEntries: true, canRequest: true, canRefresh: false, blockedReason: null, retryAt: null, connection: null, ...overrides };
}
function store(overrides: Record<string, unknown> = {}) {
  return { ready: true, authed: true, error: null, refresh: mocks.refresh, flushEntries: vi.fn(), db: { profile: { nick: "기록", consent: true }, artworks: {}, drafts: { [date]: [entry] }, ...overrides } };
}
function setPayload(value: ReturnType<typeof payload>, overrides: Record<string, unknown> = {}) {
  mocks.hook.mockReturnValue({ payload: value, loading: false, posting: false, error: null, refresh: mocks.refresh, start: mocks.start, ...overrides });
}
const render = () => renderToStaticMarkup(createElement(ConnectionPage));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-25T10:00:00Z")); vi.stubGlobal("React", React);
  mocks.search.mockReturnValue(new URLSearchParams(`date=${date}`)); mocks.store.mockReturnValue(store()); setPayload(payload());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("private diary-to-news screen", () => {
  test("a diary without a picture can connect and shows real fragments instead of example images", () => {
    const html = render();
    expect(html).toContain(entry.text);
    expect(html).toContain("그림 대신, 이날의 조각");
    expect(html).toContain("이날의 뉴스 연결하기");
    expect(html).not.toContain("<img");
    expect(html).toContain("일기 원문과 그림에 저장된 장면 요약·태그를 OpenAI로 보내");
    expect(html).toContain("그림 파일 자체를 AI로 분석하지 않으며");
    expect(html).toContain("공개 전시에 포함되지 않아요");
    expect(html).toContain("일기 날짜 기준 이전 한 달(당일 포함)");
    expect(html).toContain("새로 연결할 뉴스 범위 · 2026. 10. 4. – 2026. 11. 4.");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  test("an empty day offers writing instead of a generation button", () => {
    mocks.store.mockReturnValue(store({ drafts: {} })); setPayload(payload({ hasEntries: false, canRequest: false }));
    const html = render();
    expect(html).toContain(`href="/gallery/${date}"`);
    expect(html).toContain("이날 기록하기");
    expect(html).not.toContain("이날의 뉴스 연결하기");
  });

  test.each(["invalid", "2026-02-30", "0000-01-01", "2026-11-26"])("invalid or future %s does not read the connection API", invalid => {
    mocks.search.mockReturnValue(new URLSearchParams(`date=${invalid}`));
    expect(render()).toContain("달력으로 돌아가기");
    expect(mocks.hook).not.toHaveBeenCalled();
  });

  test("the default date is today and the picker includes drafts, artworks and old connection dates", () => {
    mocks.search.mockReturnValue(new URLSearchParams());
    mocks.store.mockReturnValue(store({ artworks: { "2026-10-01": { entries: [entry] } } }));
    setPayload(payload({ date: today, dates: ["2026-09-01", "2026-11-26"] }));
    const html = render();
    expect(mocks.hook.mock.calls[0][0]).toBe(today);
    for (const day of [date, today, "2026-10-01", "2026-09-01"]) expect(html).toContain(`value="${day}"`);
    expect(html).not.toContain('value="2026-11-26"');
  });

  test("a saved result keeps the personal picture and shows the diary-relative publication range separately from search time", () => {
    mocks.store.mockReturnValue(store({ artworks: { [date]: { status: "ready", imageUrl: "https://images.example/personal.png", summary: "나의 코딩 공부", entries: [entry] } } }));
    setPayload(payload({ connection: result(), canRequest: false, canRefresh: true }));
    const html = render();
    expect(html).toContain('src="https://images.example/personal.png"');
    expect(html).toContain('src="https://images.example/news.png"');
    expect(html).toContain("일기 날짜 기준 이전 한 달(당일 포함)");
    expect(html).toMatch(/datetime="2026-11-25T10:00:00Z"/i);
    expect(html).toContain("2026. 10. 4. – 2026. 11. 4.");
    expect(html).toContain("보도 검색 범위");
    expect(html).toContain("뉴스 다시 연결하기");
    expect(html).not.toContain("최근 7일");
    expect(html).not.toContain("저장된 뉴스의 검색 범위가 달라요");
    expect(html).toContain("저장된 결과예요");
    expect(html).toContain('href="https://news.example/article"');
    expect(html).toContain("내 하루와 이어지는 지점");
    expect(html.indexOf("새 개발 도구가 바꾸는 코딩")).toBeLessThan(html.indexOf("원문 보기"));
    expect(html.indexOf("원문 보기")).toBeLessThan(html.indexOf('src="https://images.example/news.png"'));
    expect(html.indexOf('src="https://images.example/news.png"')).toBeLessThan(html.indexOf('aria-label="뉴스 연결 요청"'));
    expect(html).toMatch(/<details[^>]*><summary>뉴스 다시 연결하기/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain('aria-label="연결된 뉴스 그림 크게 보기"');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  test("no-match is explicit and contains no invented generated image", () => {
    setPayload(payload({ connection: result({ status: "no_match", headline: null, imageUrl: null, sources: [] }), canRequest: false, canRefresh: true }));
    const html = render();
    expect(html).toContain("잘 맞는 뉴스를 찾지 못했어요");
    expect(html).not.toContain("<img");
    expect(html).toContain("뉴스 다시 연결하기");
    expect(html).toContain("검색 범위 안에서 충분히 관련 있는 기사");
  });

  test("changed records identify the displayed result as based on previous diary content", () => {
    setPayload(payload({ connection: result({ sourceChanged: true }), canRefresh: true }));
    expect(render()).toContain("아래 뉴스는 이전 조각글·장면을 바탕으로 찾았어요");
  });

  test("a legacy saved result retains its actual old range and image until the user reconnects", () => {
    setPayload(payload({ connection: result({ rangeChanged: true, newsFrom: "2026-11-19T00:00:00+09:00", newsTo: "2026-11-25T19:00:00+09:00" }), canRequest: false, canRefresh: true }));
    const html = render();
    expect(html).toContain('src="https://images.example/news.png"');
    expect(html).toContain("저장된 뉴스의 검색 범위가 달라요");
    expect(html).toContain("아래 결과는 이전 검색 범위로 저장됐어요");
    expect(html).toContain("보도 범위 · 2026. 11. 19. – 2026. 11. 25.");
    expect(html).toContain("새로 연결할 뉴스 범위 · 2026. 10. 4. – 2026. 11. 4.");
    expect(html).toContain("뉴스 다시 연결하기");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  test("withdrawing consent keeps saved images readable but disables new requests", () => {
    setPayload(payload({ connection: result(), consent: false, canRequest: false, canRefresh: false }));
    const html = render();
    expect(html).toContain('src="https://images.example/news.png"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>뉴스 다시 연결하기/);
    expect(html).toContain("동의 설정하기");
  });

  test.each([null, undefined, ""])("approved work with selectedAt=%s shows its stage without a fabricated search time or second action", selectedAt => {
    setPayload(payload({ connection: result({ status: "processing", stage: "searching", headline: null, imageUrl: null, selectedAt }), canRequest: false }));
    const html = render();
    expect(html).toContain("뉴스 찾기 중…");
    expect(html).not.toContain("뉴스 다시 연결하기");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("뉴스 검색 ·");
    expect(html).not.toContain("1970");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  test("unsafe source protocols are not rendered as links", () => {
    setPayload(payload({ connection: result({ sources: [{ title: "unsafe", url: "javascript:alert(1)" }] }) }));
    const html = render();
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("unsafe");
  });

  test("dates use the same explicit apply and today controls as cartoons", () => {
    const html = render();
    expect(html).toContain('<button type="submit">보기</button>');
    expect(html).toContain('<button type="button">오늘</button>');
    expect(html).toContain('aria-label="하루세상 메뉴"');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
