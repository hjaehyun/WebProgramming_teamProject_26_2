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
const now = new Date("2026-11-25T10:00:00Z");
function payload(overrides: Record<string, unknown> = {}) {
  return { today, dates: [], enabled: true, canRequest: true, availableAt: `${date}T19:00:00+09:00`, cartoon: null, ...overrides };
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
    expect(html).toContain("이날 보기");
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
    setPayload(payload({ canRequest: false, availableAt: `${today}T19:00:00+09:00` }), { fetchedAt: now.getTime() - 1000 });
    const html = render();
    expect(html).toContain("저녁 7시 이후에 만나요");
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
});
