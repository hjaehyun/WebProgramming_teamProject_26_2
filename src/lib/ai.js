// Client side of the AI layer. Screens call these; the work happens in app/api/*,
// where src/server/ai picks a provider (mock by default) from env.
// Result shapes (DaySummary, Drawing, CurationText) are described in ./types.js.

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `${path} ${res.status}`);
  return data;
}

/** Text AI step: fragments -> one scene description + tags. */
export function summarizeDay(entries) {
  return post("/api/summarize", { entries });
}

/** Image AI step: scene description -> picture. */
export function drawScene(summary, style, date) {
  return post("/api/draw", { summary, style, date });
}

/**
 * Counts tags locally (SQL group by in the real version); no AI involved.
 * Returns { picks: artwork dates, top: [{ tag, count, scene }] }.
 */
export function curationStats(works) {
  const counts = new Map();
  works.forEach((w) =>
    w.tags.forEach((t) => {
      const cur = counts.get(t);
      counts.set(t, { count: (cur?.count ?? 0) + 1, scene: cur?.scene ?? w.scene });
    }),
  );
  const top = Array.from(counts.entries())
    .map(([tag, v]) => ({ tag, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return { picks: works.slice(0, 4).map((w) => w.date), top };
}

/** Curator commentary from the counted tags and saved scene summaries. */
export function writeCuration(works, stats, periodLabel) {
  return post("/api/curate", {
    periodLabel,
    count: works.length,
    top: stats.top.map(({ tag, count }) => ({ tag, count })),
    summaries: works.map((w) => w.summary),
  });
}
