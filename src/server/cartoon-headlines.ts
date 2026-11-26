import "server-only";

/** Placement comes from a broadcaster's dated replay list, never from model output. */
export type BroadcastHeadline = {
  title: string; url: string; publisher: string; domain: string;
  prominence: { kind: "broadcast_running_order"; program: string; editionDate: string; rank: number; url: string };
};

const SBS = "https://news.sbs.co.kr";
const MBC = "https://imnews.imbc.com";
const MAX_BYTES = 700_000;
const ARCHIVE_TIMEOUT = 12_000;
const REQUEST_TIMEOUT = 8_000;
const MAX_HEADLINES = 3;
const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", hellip: "…", middot: "·", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—" };

function decode(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

function attribute(tag: string, name: string) {
  const matches = [...tag.matchAll(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "gi"))];
  return matches.length === 1 ? decode(matches[0][2]) : null;
}

function hasClass(tag: string, name: string) {
  return attribute(tag, "class")?.split(/\s+/).includes(name) ?? false;
}

function cleanHtml(html: string) {
  // Only visible list markup can establish placement, not embedded JSON, scripts or comments.
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
}

function cleanTitle(html: string) {
  const value = decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return value && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function overview(title: string) {
  return /^(?:(?:\d{1,4}[년월일.\s-]*)+\s*)?(?:\[?주요\s*뉴스\]?|(?:뉴스데스크|8뉴스)\s*(?:전체|다시보기|클로징|오프닝)|전체\s*(?:다시보기|재생)|클로징|오프닝|\[?날씨\]?)(?:\s|$|[:\]])/.test(title);
}

function editionDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "0001-01-01") return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

async function readArchive(url: string, deadline: number) {
  const timeout = Math.min(REQUEST_TIMEOUT, deadline - Date.now());
  if (timeout <= 0) throw new Error("archive deadline");
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("archive response");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, content = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error("archive size"); }
      content += decoder.decode(part.value, { stream: true });
    }
    content += decoder.decode();
  } finally { reader.releaseLock(); }
  return content.replace(/^\uFEFF/, "");
}

function result(title: string, url: string, rank: number, date: string, source: "sbs" | "mbc", archive: string): BroadcastHeadline {
  return { title, url, publisher: source === "sbs" ? "SBS" : "MBC", domain: source === "sbs" ? "news.sbs.co.kr" : "imnews.imbc.com",
    prominence: { kind: "broadcast_running_order", program: source === "sbs" ? "SBS 8뉴스" : "MBC 뉴스데스크", editionDate: date, rank, url: archive } };
}

function sbsHeadlines(raw: string, date: string, archive: string) {
  const html = cleanHtml(raw), compact = date.replaceAll("-", "");
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].filter(m => attribute(m[0], "rel") === "canonical");
  if (canonical.length !== 1) return [];
  const canonicalUrl = new URL(attribute(canonical[0][0], "href") ?? "", SBS);
  if (canonicalUrl.origin !== SBS || canonicalUrl.pathname !== "/news/programMain.do" || canonicalUrl.searchParams.get("prog_cd") !== "R1" || canonicalUrl.searchParams.get("broad_date") !== compact) return [];
  const dates = [...html.matchAll(/<strong\b([^>]*)>([\s\S]*?)<\/strong\s*>/gi)].filter(m => hasClass(m[1], "date"));
  if (dates.length !== 1 || cleanTitle(dates[0][2]) !== date.replaceAll("-", ".")) return [];
  const lists = [...html.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul\s*>/gi)].filter(m => attribute(m[1], "id") === "article-list");
  if (lists.length !== 1 || !hasClass(lists[0][1], "type_thumb")) return [];
  const items = [...lists[0][2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)];
  if (!items.length || items.length > 100) return [];
  const headlines: BroadcastHeadline[] = [], seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const anchors = [...item[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
    const checkboxes = [...item[1].matchAll(/<input\b[^>]*>/gi)].filter(m => attribute(m[0], "type") === "checkbox");
    if (anchors.length !== 1 || checkboxes.length !== 1 || attribute(checkboxes[0][0], "id") !== `chk-${index + 1}`) return [];
    const article = new URL(attribute(anchors[0][1], "href") ?? "", SBS), id = article.searchParams.get("news_id");
    if (article.origin !== SBS || article.pathname !== "/news/endPage.do" || !/^N\d+$/.test(id ?? "") || article.username || article.password || id !== attribute(checkboxes[0][0], "data-id") || seen.has(id!)) return [];
    seen.add(id!);
    const titles = [...anchors[0][2].matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong\s*>/gi)];
    if (titles.length !== 1) return [];
    const title = cleanTitle(titles[0][1].replace(/<em\b[^>]*>[\s\S]*?<\/em\s*>/gi, ""));
    if (!title) return [];
    if (!overview(title)) headlines.push(result(title, `${SBS}/news/endPage.do?news_id=${id}`, headlines.length + 1, date, "sbs", archive));
    if (headlines.length === MAX_HEADLINES) break;
  }
  return headlines;
}

function mbcHeadlines(raw: string, date: string, archive: string) {
  const html = cleanHtml(raw);
  const dates = [...html.matchAll(/<meta\b[^>]*>/gi)].filter(m => attribute(m[0], "property") === "article:published_time");
  if (dates.length !== 1 || attribute(dates[0][0], "content") !== date) return [];
  const sections = [...html.matchAll(/<div\b[^>]*>/gi)].filter(m => hasClass(m[0], "list_area") && hasClass(m[0], "list_top"));
  if (sections.length !== 1) return [];
  const from = sections[0].index! + sections[0][0].length;
  const list = /^\s*<ul\b([^>]*)>([\s\S]*?)<\/ul\s*>/i.exec(html.slice(from));
  if (!list || !hasClass(list[1], "thumb_type") || !hasClass(list[1], "list_thumb_c")) return [];
  const items = [...list[2].matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li\s*>/gi)];
  if (!items.length || items.length > 30) return [];
  const headlines: BroadcastHeadline[] = [], seen = new Set<string>();
  for (const item of items) {
    if (!hasClass(item[1], "item")) return [];
    const anchors = [...item[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)];
    if (anchors.length !== 1) return [];
    const article = new URL(attribute(anchors[0][1], "href") ?? "", MBC);
    if (article.origin !== MBC || article.username || article.password || article.search || article.hash || !new RegExp(`^/replay/${date.slice(0, 4)}/nwdesk/article/\\d+_\\d+\\.html$`).test(article.pathname) || seen.has(article.href)) return [];
    seen.add(article.href);
    const titles = [...anchors[0][2].matchAll(/<span\b[^>]*>/gi)].filter(m => hasClass(m[0], "tit"));
    if (titles.length !== 1) return [];
    const titleStart = titles[0].index! + titles[0][0].length;
    const titleEnd = anchors[0][2].indexOf("</span>", titleStart);
    const title = titleEnd < 0 ? null : cleanTitle(anchors[0][2].slice(titleStart, titleEnd));
    if (!title) return [];
    if (!overview(title)) headlines.push(result(title, article.href, headlines.length + 1, date, "mbc", archive));
    if (headlines.length === MAX_HEADLINES) break;
  }
  return headlines;
}

async function loadMbc(date: string, deadline: number) {
  const base = `${MBC}/replay/${date.slice(0, 4)}/nwdesk/`;
  const calendar: unknown = JSON.parse(await readArchive(`${base}cal_data.js`, deadline));
  if (!calendar || typeof calendar !== "object" || Array.isArray(calendar)) return [];
  const { Link, TempleteId, DateList } = calendar as Record<string, unknown>;
  if (Link !== base || !/^\d{1,12}$/.test(String(TempleteId)) || !Array.isArray(DateList) || DateList.length > 366) return [];
  const entries = DateList.filter(e => e && typeof e === "object" && e.Day === date.replaceAll("-", ""));
  if (entries.length !== 1 || typeof entries[0].CurrentID !== "string" || !/^\d{1,12}$/.test(entries[0].CurrentID)) return [];
  const archive = `${base}${entries[0].CurrentID}_${TempleteId}.html`;
  return mbcHeadlines(await readArchive(archive, deadline), date, archive);
}

/** Both publishers are independently optional: unavailable or changed archives contribute no placement. */
export async function loadBroadcastHeadlines(date: string, deadline: number): Promise<BroadcastHeadline[]> {
  if (!editionDate(date) || !Number.isFinite(deadline) || deadline <= Date.now()) return [];
  const archiveDeadline = Math.min(deadline, Date.now() + ARCHIVE_TIMEOUT);
  const sbsArchive = `${SBS}/news/programMain.do?prog_cd=R1&broad_date=${date.replaceAll("-", "")}`;
  const settled = await Promise.allSettled([
    readArchive(sbsArchive, archiveDeadline).then(html => sbsHeadlines(html, date, sbsArchive)),
    loadMbc(date, archiveDeadline),
  ]);
  return settled.flatMap(item => item.status === "fulfilled" ? item.value : []);
}
