import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ store: vi.fn(), search: vi.fn(), hook: vi.fn(), start: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("../src/lib/store", () => ({ useStore: mocks.store }));
vi.mock("../src/lib/cartoon-client", async importOriginal => ({ ...await importOriginal<typeof import("../src/lib/cartoon-client")>(), useEdition: mocks.hook }));
vi.mock("next/navigation", () => ({ useSearchParams: mocks.search, useRouter: () => ({ replace: mocks.replace }), usePathname: () => "/cartoon" }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => createElement("a", { ...props, href }, children) }));
let CartoonPage: typeof import("../src/app/cartoon/page").default;
beforeAll(async () => { vi.stubGlobal("React", React); CartoonPage = (await import("../src/app/cartoon/page")).default; });
const date = "2026-11-04", today = "2026-11-25";
const now = new Date("2026-11-25T13:00:00Z");
function payload(overrides: Record<string, unknown> = {}) {
  return { today, dates: [], enabled: true, canRequest: true, availableAt: `${date}T22:00:00+09:00`, cartoon: null, ...overrides };
}
function setPayload(value: ReturnType<typeof payload>, overrides: Record<string, unknown> = {}) {
  mocks.hook.mockReturnValue({ payload: value, loading: false, posting: false, error: null, fetchedAt: now.getTime(), refresh: mocks.refresh, start: mocks.start, ...overrides });
}
const render = () => renderToStaticMarkup(createElement(CartoonPage));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.stubGlobal("React", React);
  mocks.search.mockReturnValue(new URLSearchParams(`date=${date}`));
  mocks.store.mockReturnValue({ ready: true, authed: true, error: null, refresh: mocks.refresh, db: { profile: { nick: "기록" }, artworks: {}, drafts: {} } });
  setPayload(payload());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("past-date cartoon screen", () => {
  test("an unpublished past day offers explicit creation without needing a personal picture", () => {
    const html = render();
    expect(html).toContain("이날의 만평 준비하기");
    expect(html).toContain("선택한 날짜에 나온 보도");
    expect(html).toContain('type="date"');
    expect(html).toContain(`value="${date}"`);
    expect(html).toContain(`max="${today}"`);
    expect(html).toContain('<button type="submit">보기</button>');
    expect(html).toContain('<button type="button">오늘</button>');
    expect(html).toContain("아직 나의 그림이 없어요");
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.hook.mock.calls[0][0]).toBe(date);
  });

  test.each(["", "invalid", "2026-02-30", "0000-01-01", "2026-11-26"])("invalid or future %s never requests today's edition accidentally", invalid => {
    mocks.search.mockReturnValue(new URLSearchParams(`date=${invalid}`));
    expect(render()).toContain("오늘까지의 날짜를 골라 주세요");
    expect(mocks.hook).not.toHaveBeenCalled();
  });

  test("the default route passes an explicit current Seoul date to the session", () => {
    mocks.search.mockReturnValue(new URLSearchParams());
    render();
    expect(mocks.hook.mock.calls[0][0]).toBe(today);
  });

  test("the archive list contains saved dates while the date input can reach other days", () => {
    setPayload(payload({ dates: [today, "2025-04-01", "2026-11-26", "bad"] }));
    const html = render();
    expect(html).toContain("저장된 만평");
    expect(html).toContain('<option value="2025-04-01">');
    expect(html).not.toContain('<option value="2026-11-26">');
    expect(html).not.toContain('<option value="bad">');
    expect(html).not.toContain(`<option value="${date}">`);
    expect(html).toContain(`value="${date}"`);
  });

  test("completed past editions preserve both stored pictures and have no generate button", () => {
    mocks.store.mockReturnValue({ ready: true, authed: true, error: null, refresh: mocks.refresh, db: {
      profile: {}, artworks: { [date]: { status: "ready", imageUrl: "https://images.example/personal.png", summary: "나의 하루" } }, drafts: {},
    } });
    setPayload(payload({ canRequest: false, cartoon: { date, status: "ready", headline: "이날의 대표 뉴스", caption: "이날의 만평", imageUrl: "https://images.example/cartoon.png", sources: [] } }));
    const html = render();
    expect(html).toContain('src="https://images.example/personal.png"');
    expect(html).toContain('src="https://images.example/cartoon.png"');
    expect(html).not.toContain("이날의 만평 준비하기");
    expect(html).not.toContain("다시 시도하기");
  });

  test("today before publication time keeps the evening notice and no request button", () => {
    mocks.search.mockReturnValue(new URLSearchParams(`date=${today}`));
    setPayload(payload({ canRequest: false, availableAt: `${today}T22:00:00+09:00` }), { fetchedAt: now.getTime() - 1000 });
    const html = render();
    expect(html).toContain("밤 10시 이후에 만나요");
    expect(html).not.toContain("오늘의 만평 준비하기");
  });

  test("a past failure only exposes retry when the server cooldown permits it", () => {
    const cartoon = { date, status: "failed", error: "잠시 후 다시 확인해 주세요." };
    setPayload(payload({ cartoon, canRequest: false }));
    expect(render()).not.toContain("다시 시도하기");
    setPayload(payload({ cartoon, canRequest: true }));
    expect(render()).toContain("다시 시도하기");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  test("an unavailable edition offers explicit news reselection when the server allows it", () => {
    const cartoon = { date, status: "unavailable", attempts: 1, maxAttempts: 3, retryAt: null, error: "대표 뉴스를 찾지 못했어요." };
    setPayload(payload({ cartoon, canRequest: true }));
    const html = render();
    expect(html).toContain("선정할 뉴스를 확인하지 못했어요");
    expect(html).toContain("방송 선두 기사와 다른 매체의 보도를 다시 확인할 수 있어요.");
    expect(html).toContain("근거가 부족하면 다른 기사로 대신 채우지 않아요.");
    expect(html).toContain("뉴스 다시 선정하기");
    expect(html).toContain("1 / 3회 사용");
    expect(mocks.start).not.toHaveBeenCalled();
    setPayload(payload({ cartoon, canRequest: false }));
    expect(render()).not.toContain("뉴스 다시 선정하기");
    setPayload(payload({ cartoon, canRequest: true }), { posting: true });
    expect(render()).toContain("대표 뉴스를 살펴보고 있어요");
    expect(render()).not.toContain("뉴스 다시 선정하기");
  });

  test("a completed edition puts its original source before the expandable stored pictures", () => {
    setPayload(payload({ canRequest: false, cartoon: { date, status: "ready", headline: "저장된 만평 제목", caption: "저장된 실제 그림", imageUrl: "https://images.example/cartoon.png", sources: [{ url: "https://news.example/story", publisher: "검증된 매체", publishedAt: "2026-11-04T10:00:00Z" }] } }));
    const html = render();
    expect(html.indexOf("저장된 만평 제목")).toBeLessThan(html.indexOf("원문 보기"));
    expect(html.indexOf("원문 보기")).toBeLessThan(html.indexOf('aria-label="하루만평 크게 보기"'));
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("선택한 날짜에 나온 보도를 한국 시간");
    expect(html).toMatch(/<details[^>]*><summary>저장된 만평/);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).not.toContain("방송 선두 배치 확인");
  });

  test.each([
    // Match the archive reader's actual URL order, while retaining the reversed-order case below.
    { publisher: "SBS", program: "SBS 8뉴스", url: "https://news.sbs.co.kr/news/programMain.do?prog_cd=R1&broad_date=20261104", rank: 1, order: "첫 번째" },
    { publisher: "MBC", program: "MBC 뉴스데스크", url: "https://imnews.imbc.com/replay/2026/nwdesk/6863544_36999.html", rank: 2, order: "두 번째" },
    { publisher: "SBS", program: "SBS 8뉴스", url: "https://news.sbs.co.kr/news/programMain.do?broad_date=20261104&prog_cd=R1", rank: 3, order: "세 번째" },
  ])("shows the validated $program archive separately from the original article", ({ publisher, program, url, rank, order }) => {
    const source = { title: "확인한 원문 기사", url: "https://news.example/article", publisher, publishedAt: `${date}T11:00:00+09:00`,
      prominence: { kind: "broadcast_running_order", editionDate: date, program, url, rank } };
    setPayload(payload({ canRequest: false, cartoon: { date, status: "ready", headline: "저장된 뉴스", sources: [source] } }));
    const html = render();
    expect(html).toContain(`href="${url.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`${program} 기사 목록 · ${order} 보도`);
    expect(html).toContain("방송 선두 배치 확인");
    expect(html).not.toContain("전체 뉴스 첫 뉴스");
    expect(html).toContain("확인한 원문 기사");
    expect(html).toMatch(/<\/a><a[^>]+href="https:\/\/(?:news\.sbs\.co\.kr|imnews\.imbc\.com)/);
  });

  test.each([
    { rank: 0 }, { rank: 4 }, { rank: 1.5 }, { rank: "1" },
    { kind: "model_claim" }, { editionDate: "2026-11-05" }, { program: "unknown" },
    { url: "javascript:alert(1)" },
    { url: "https://news.sbs.co.kr.evil.test/news/programMain.do?broad_date=20261104&prog_cd=R1" },
    { url: "http://news.sbs.co.kr/news/programMain.do?broad_date=20261104&prog_cd=R1" },
    { url: "https://news.sbs.co.kr/news/programMain.do?broad_date=20261105&prog_cd=R1" },
    { url: "https://news.sbs.co.kr/news/programMain.do?broad_date=20261104&prog_cd=R2" },
    { url: "https://news.sbs.co.kr/news/programMain.do?prog_cd=R1&broad_date=20261104&broad_date=20261105" },
    { url: "https://news.sbs.co.kr/news/programMain.do?prog_cd=R1&broad_date=20261104&extra=1" },
    { url: "https://news.sbs.co.kr/news/programMain.do?prog_cd=R1&prog_cd=R1" },
    { url: "https://news.sbs.co.kr/news/programMain.do?broad_date=20261104&prog_cd=R1#claim" },
    { program: "MBC 뉴스데스크", url: "https://imnews.imbc.com/replay/2025/nwdesk/6863544_36999.html" },
    { program: "MBC 뉴스데스크", url: "https://imnews.imbc.com/news/2026/society/article/6863544_36999.html" },
  ])("hides invalid broadcast metadata while retaining the original source: %j", replacement => {
    const source = { title: "기존 원문 기사", url: "https://news.example/article", publisher: replacement.program === "MBC 뉴스데스크" ? "MBC" : "SBS",
      prominence: { kind: "broadcast_running_order", editionDate: date, program: "SBS 8뉴스", rank: 1,
        url: "https://news.sbs.co.kr/news/programMain.do?broad_date=20261104&prog_cd=R1", ...replacement } };
    setPayload(payload({ canRequest: false, cartoon: { date, status: "ready", headline: "뉴스", sources: [source] } }));
    const html = render();
    expect(html).not.toContain("방송 선두 배치 확인");
    expect(html).toContain("기존 원문 기사");
  });

  test.each(["failed", "unavailable"])("a %s cooldown displays its exact retry time instead of a stale relative delay", status => {
    setPayload(payload({ canRequest: false, cartoon: { date, status, attempts: 1, maxAttempts: 3, retryAt: "2026-11-25T10:15:00Z", error: "15분 뒤 다시 시도할 수 있어요." } }));
    const html = render();
    expect(html).toMatch(/datetime="2026-11-25T10:15:00Z"/i);
    expect(html).toContain("이후 재시도 가능 (한국 시간)");
    expect(html).toContain("1 / 3회 사용");
    expect(html).not.toContain("15분 뒤");
    expect(html).not.toContain("다시 시도하기");
    expect(html).not.toContain("뉴스 다시 선정하기");
  });

  test.each(["failed", "unavailable"])("exhausted %s attempts are distinct from a temporary cooldown", status => {
    setPayload(payload({ canRequest: false, cartoon: { date, status, attempts: 3, maxAttempts: 3, retryAt: null } }));
    const html = render();
    expect(html).toContain("이날의 생성 시도를 모두 사용했어요");
    expect(html).toContain("3 / 3회 사용");
    expect(html).not.toContain("이후 재시도 가능");
    expect(html).not.toContain("다시 시도하기");
    expect(html).not.toContain("뉴스 다시 선정하기");
  });
});
