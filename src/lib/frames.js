// Frames a picture can be shown in. Drawn with CSS only (components/Framed.jsx); the image itself
// never changes. Same ids, in the same order, as the server list and the DB check.
export const FRAMES = [
  { id: "basic", label: "기본" },
  { id: "diary", label: "그림일기" },
  { id: "polaroid", label: "폴라로이드" },
  { id: "wood", label: "원목 액자" },
  { id: "tape", label: "마스킹테이프" },
  { id: "sketch", label: "스케치북" },
];

/** A known frame id, or "basic" for anything else (missing, old or unknown). */
export function frameOf(id) {
  return FRAMES.some((f) => f.id === id) ? id : "basic";
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("ko", { granularity: "grapheme" }) : null;

/** The 원고지 grid of the 그림일기 frame: one character per cell, spaces left blank, cut or padded to n cells. */
export function diaryCells(text, n = 40) {
  const chars = segmenter ? Array.from(segmenter.segment(text ?? ""), (s) => s.segment) : Array.from(text ?? "");
  const cells = chars.slice(0, n).map((c) => (c.trim() ? c : ""));
  while (cells.length < n) cells.push("");
  return cells;
}

/** The day's weather words for the 그림일기 frame: in time order, no repeats, at most three. */
export function dayWeathers(entries) {
  const out = [];
  for (const e of [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    const w = e.weather?.weather;
    if (w && !out.includes(w)) out.push(w);
    if (out.length === 3) break;
  }
  return out;
}
