import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { loadBroadcastHeadlines } from "../src/server/cartoon-headlines";

const day = "2026-11-06";
const sbsArchive = "https://news.sbs.co.kr/news/programMain.do?prog_cd=R1&broad_date=20261106";
const mbcCalendar = "https://imnews.imbc.com/replay/2026/nwdesk/cal_data.js";
const mbcArchive = "https://imnews.imbc.com/replay/2026/nwdesk/1234567_36999.html";
const calendar = { Link: "https://imnews.imbc.com/replay/2026/nwdesk/", TempleteId: 36999, DateList: [{ Day: "20261106", CurrentID: "1234567" }] };
const titles = ["전국 산불에 대피 명령", "경제 대책에 &quot;추가 논의&quot;", "국제 협정 후속 조치", "대중교통 운행 재개"];
const fetchMock = vi.fn<typeof fetch>();

// Reduced fixtures preserve the public replay HTML structure observed on 2026-11-26.
// SBS: canonical + visible strong.date + #article-list li + numbered checkbox.
// MBC: published-time meta + .list_area.list_top ul.thumb_type.list_thumb_c li.item.
function sbsFixture(headlines = titles) {
  return `<link rel="canonical" href="${sbsArchive.replaceAll("&", "&amp;")}">
    <div class="w_cal_head"><strong class="date">2026.11.06</strong></div>
    <a href="/news/endPage.do?news_id=N999">A recommendation outside the replay</a>
    <ul class="type_thumb" id="article-list">${headlines.map((title, i) => `<li>
      <a href="/news/endPage.do?news_id=N100${i + 1}&amp;plink=THUMB&amp;cooper=SBSNEWSPROGRAM">
        <span class="thumb"><img alt="thumbnail"><em>동영상 기사</em></span>
        <p class="desc"><strong><em class="cate">사회</em>${title}</strong></p>
      </a><span class="i_chk"><input type="checkbox" id="chk-${i + 1}" data-id="N100${i + 1}"></span>
    </li>`).join("")}</ul>`;
}
function mbcFixture(headlines = titles) {
  return `<meta property="article:published_time" content="${day}">
    <div class="list_area list_top wrapper"><ul class="thumb_type list_thumb_c">${headlines.map((title, i) => `<li class="item">
      <a href="https://imnews.imbc.com/replay/2026/nwdesk/article/765432${i}_37004.html">
        <span class="img ico_vod"><img alt="thumbnail"></span><span class="txt_w">
          <span class="tit ellipsis2">${title}</span><span class="sub">Article teaser is not evidence.</span>
        </span>
      </a></li>`).join("")}</ul></div>
    <div class="list_area list_bottom wrapper"><ul class="thumb_type list_thumb_c"><li class="item">Not a top story</li></ul></div>`;
}
function routes(sbs: string | Response | null = sbsFixture(), mbc: string | Response | null = mbcFixture(), cal: unknown = calendar) {
  fetchMock.mockImplementation(async url => {
    if (url === sbsArchive) return sbs instanceof Response ? sbs : new Response(sbs ?? "", { status: sbs === null ? 503 : 200 });
    if (url === mbcCalendar) return new Response(`\uFEFF${JSON.stringify(cal)}`);
    if (url === mbcArchive) return mbc instanceof Response ? mbc : new Response(mbc ?? "", { status: mbc === null ? 503 : 200 });
    throw new Error(`Unexpected URL ${String(url)}`);
  });
}
const load = () => loadBroadcastHeadlines(day, Date.now() + 30_000);

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); routes(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("dated broadcast running-order evidence", () => {
  test("reads three real reports from each official replay and keeps their source-owned order", async () => {
    const result = await load();
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({ title: titles[0], url: "https://news.sbs.co.kr/news/endPage.do?news_id=N1001", publisher: "SBS", domain: "news.sbs.co.kr",
      prominence: { kind: "broadcast_running_order", program: "SBS 8뉴스", editionDate: day, rank: 1, url: sbsArchive } });
    expect(result[1].title).toBe('경제 대책에 "추가 논의"');
    expect(result[3]).toMatchObject({ title: titles[0], publisher: "MBC", prominence: { program: "MBC 뉴스데스크", rank: 1, url: mbcArchive } });
    expect(result.map(x => x.prominence.rank)).toEqual([1, 2, 3, 1, 2, 3]);
    expect(result.some(x => x.title.includes("recommendation") || x.title.includes("teaser"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, options] of fetchMock.mock.calls) expect(options).toMatchObject({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) });
  });

  test("excludes headline roundups, full replay and weather, then ranks substantive reports", async () => {
    routes(sbsFixture(["주요 뉴스", "8뉴스 전체 다시보기", "[날씨] 내일 맑음", ...titles]), mbcFixture(["뉴스데스크 오프닝", ...titles]));
    const result = await load();
    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ title: titles[0], url: "https://news.sbs.co.kr/news/endPage.do?news_id=N1004", prominence: { rank: 1 } });
    expect(result[3]).toMatchObject({ title: titles[0], url: "https://imnews.imbc.com/replay/2026/nwdesk/article/7654321_37004.html", prominence: { rank: 1 } });
  });

  test.each([
    ["canonical date", (s: string) => s.replace("broad_date=20261106", "broad_date=20261105")],
    ["visible date", (s: string) => s.replace("2026.11.06", "2026.11.05")],
    ["wrong program", (s: string) => s.replace("prog_cd=R1", "prog_cd=C2")],
    ["changed list markup", (s: string) => s.replace('id="article-list"', 'id="new-list"')],
    ["nonconsecutive order", (s: string) => s.replace('id="chk-2"', 'id="chk-8"')],
    ["article-id mismatch", (s: string) => s.replace('data-id="N1002"', 'data-id="N1009"')],
    ["duplicate top story", (s: string) => s.replaceAll("N1002", "N1001")],
    ["external story link", (s: string) => s.replace('/news/endPage.do?news_id=N1001', 'https://evil.example/news/endPage.do?news_id=N1001')],
  ])("rejects SBS %s while retaining independently available MBC evidence", async (_name, change) => {
    routes(change(sbsFixture()));
    expect((await load()).map(x => x.publisher)).toEqual(["MBC", "MBC", "MBC"]);
  });

  test.each([
    ["published date", (s: string) => s.replace(day, "2026-11-05")],
    ["changed list markup", (s: string) => s.replace("list_area list_top", "list_area recommended")],
    ["duplicate top story", (s: string) => s.replace("7654321_37004", "7654320_37004")],
    ["external URL", (s: string) => s.replace("https://imnews.imbc.com/replay/2026/nwdesk/article/7654320", "https://imnews.imbc.com.evil.example/replay/2026/nwdesk/article/7654320")],
    ["article from another program", (s: string) => s.replace("nwdesk/article/7654320", "nwtoday/article/7654320")],
    ["missing title", (s: string) => s.replace('class="tit ellipsis2"', 'class="sub"')],
  ])("rejects MBC %s while retaining independently available SBS evidence", async (_name, change) => {
    routes(sbsFixture(), change(mbcFixture()));
    expect((await load()).map(x => x.publisher)).toEqual(["SBS", "SBS", "SBS"]);
  });

  test("ignores injected script/comment lists rather than discovering fake placement", async () => {
    routes(`<!-- ${sbsFixture()} --><script>${sbsFixture()}</script>`, `<script>${mbcFixture()}</script>`);
    expect(await load()).toEqual([]);
  });

  test.each([
    { ...calendar, Link: "https://evil.example/" },
    { ...calendar, TempleteId: "../../secret" },
    { ...calendar, DateList: [{ Day: "20261106", CurrentID: "../../secret" }] },
    { ...calendar, DateList: [calendar.DateList[0], calendar.DateList[0]] },
    { ...calendar, DateList: [{ Day: "20261105", CurrentID: "1234567" }] },
  ])("does not request a MBC page from untrusted or mismatched calendar data %#", async cal => {
    routes(sbsFixture(), mbcFixture(), cal);
    expect(await load()).toHaveLength(3);
    expect(fetchMock.mock.calls.map(x => x[0])).toEqual([sbsArchive, mbcCalendar]);
  });

  test("tolerates unavailable archives without replacing them with latest-date or model-generated order", async () => {
    routes(null, null);
    expect(await load()).toEqual([]);
  });

  test("rejects oversized responses even without a Content-Length header", async () => {
    routes("x".repeat(700_001), mbcFixture());
    expect((await load()).map(x => x.publisher)).toEqual(["MBC", "MBC", "MBC"]);
  });

  test.each(["2026-02-30", "../../2026", "2026-1-6", "0000-01-01"])("does not fetch malformed dates: %s", async date => {
    expect(await loadBroadcastHeadlines(date, Date.now() + 30_000)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not start work after the caller's deadline", async () => {
    expect(await loadBroadcastHeadlines(day, Date.now() - 1)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
