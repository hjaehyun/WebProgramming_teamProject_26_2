import "server-only";
import { adminClient } from "./core/supabase/server";
import { removeArtworkFolder } from "./artwork-files";

/** Days a deleted fragment or picture stays in the trash. */
export const TRASH_DAYS = 30;

/**
 * Run by the job worker: permanently removes trash older than TRASH_DAYS. A picture's files go
 * first; if that fails its rows stay and the next run tries again. At most `limit` pictures a run.
 */
export async function purgeExpiredTrash(now = new Date(), limit = 20) {
  const db = adminClient();
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 86400000).toISOString();
  const expired = await db.from("trashed_artworks").select("id,user_id").lt("deleted_at", cutoff).order("deleted_at").limit(limit);
  if (expired.error) throw expired.error;
  let artworks = 0, entries = 0;
  for (const art of expired.data ?? []) {
    try { await removeArtworkFolder(art.user_id, art.id); }
    catch { console.error("Trash file cleanup deferred", { id: art.id }); continue; }
    const bundle = await db.from("trashed_entries").delete().eq("artwork_id", art.id).select("id");
    if (bundle.error) throw bundle.error;
    const removed = await db.from("trashed_artworks").delete().eq("id", art.id).select("id");
    if (removed.error) throw removed.error;
    entries += bundle.data?.length ?? 0;
    artworks += removed.data?.length ?? 0;
  }
  const plain = await db.from("trashed_entries").delete().lt("deleted_at", cutoff).is("artwork_id", null).select("id");
  if (plain.error) throw plain.error;
  entries += plain.data?.length ?? 0;
  return { artworks, entries };
}

/**
 * Run by the daily cron, the one scheduled run that happens even when no picture is waiting:
 * purges in batches until a batch comes back short (nothing left, or files that keep failing),
 * within a time budget.
 */
export async function purgeAllExpiredTrash(now = new Date(), { limit = 20, budgetMs = 60000 } = {}) {
  const started = Date.now();
  const total = { artworks: 0, entries: 0 };
  for (;;) {
    const r = await purgeExpiredTrash(now, limit);
    total.artworks += r.artworks; total.entries += r.entries;
    if (r.artworks < limit || Date.now() - started > budgetMs) return total;
  }
}
