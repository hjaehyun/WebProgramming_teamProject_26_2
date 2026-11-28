// Trash: deleted fragments, and pictures that went with a day's last fragment, stay here for
// TRASH_DAYS days. The server owns the rules (see /api/me/trash); this file only calls it.

export const TRASH_DAYS = 30;
const DAY_MS = 86400000;

/** Whole days until the item is purged for good: 30 right after deleting, 0 once the time has passed. */
export function daysLeft(purgeAt, now = new Date()) {
  return Math.max(0, Math.ceil((Date.parse(purgeAt) - now.getTime()) / DAY_MS));
}

/** What the screen shows: items stay null until a load succeeds, so a failed first load is an error, not an empty trash. */
export function trashView(items, error) {
  if (items === null) return error ? "error" : "loading";
  return items.length ? "list" : "empty";
}

async function call(method, url) {
  const res = await fetch(url, { method, cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "요청을 완료하지 못했어요.");
  return data;
}

/** The caller's trash items, newest first. */
export async function fetchTrash() { return (await call("GET", "/api/me/trash")).items ?? []; }
/** -> { ok, restored: "entry" | "artwork" | "entry_only", date } */
export function restoreTrash(id) { return call("POST", `/api/me/trash/${encodeURIComponent(id)}/restore`); }
export function purgeTrash(id) { return call("DELETE", `/api/me/trash/${encodeURIComponent(id)}`); }
export function emptyTrash() { return call("DELETE", "/api/me/trash"); }
