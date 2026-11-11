// Client requests never contain an AI prompt or a storage path. The server reads
// the authenticated user's saved entries and runs the existing GPT worker.

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
  return data;
}

const ARTWORK_STATUSES = new Set(["queued", "processing", "ready", "failed"]);
function validArtwork(artwork, date) {
  return artwork && artwork.date === date && ARTWORK_STATUSES.has(artwork.status);
}

/** Starts one idempotent request; a pending result remains pending in the UI. */
export async function generateArtwork(date, redraw, onUpdate) {
  const requestId = crypto.randomUUID();
  let stopped = false;
  let timer;
  const polling = new AbortController();
  const status = async (signal) => {
    const res = await fetch(`/api/artworks/${encodeURIComponent(date)}`, { cache: "no-store", signal });
    if (!res.ok) return null;
    const { artwork } = await res.json();
    return validArtwork(artwork, date) ? artwork : null;
  };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    polling.abort();
  };
  const poll = async () => {
    try {
      const artwork = await status(polling.signal);
      // A GET started before this redraw may still contain the previous picture.
      // A GET completed after the final POST must not overwrite its newer state.
      if (!stopped && artwork?.requestId === requestId) onUpdate(artwork);
    } catch { /* Final response/refresh reports failures. */ }
    if (!stopped) timer = setTimeout(poll, 4000);
  };
  timer = setTimeout(poll, 2000);
  try {
    let artwork;
    try {
      const result = await post("/api/artworks", { date, redraw, requestId });
      if (!validArtwork(result?.artwork, date)) throw new Error("그림 상태를 확인하지 못했어요. 갤러리에서 다시 확인해 주세요.");
      artwork = result.artwork;
    }
    catch (error) {
      stop();
      // Explicit denials must not be disguised as success because an older ready
      // image already exists. Network/5xx failures may be ambiguous after commit.
      if (error instanceof ApiError && error.status < 500) throw error;
      const current = await status().catch(() => null);
      // Confirm this exact request; don't resubmit generation with a new ID.
      if (!current || current.requestId !== requestId) throw error;
      artwork = current;
    }
    stop();
    onUpdate(artwork);
    if (artwork.status === "failed") throw new Error(artwork.error || "그림을 완성하지 못했어요. 다시 시도해 주세요.");
    return artwork;
  } finally { stop(); }
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
  // The server reads the authenticated user's saved summaries itself.
  void stats; void periodLabel;
  return post("/api/curate", { dates: works.map(w => w.date) });
}
