import "server-only";
import { z } from "zod";
import { authenticated, json, mutation, rpcError, run } from "./request";
import { signImages, type Row } from "./data";
import { removeArtworkFolder } from "./artwork-files";
import { TRASH_DAYS } from "./trash-purge";

const DAY_MS = 86400000;
const purgeAt = (deletedAt: string) => new Date(Date.parse(deletedAt) + TRASH_DAYS * DAY_MS).toISOString();
const newestFirst = (a: { deletedAt: string }, b: { deletedAt: string }) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0);

/** The caller's trash, newest first. A picture lists the fragments trashed with it; no owner ids or storage paths. */
export function trashList() { return run(async () => {
  const { db, user } = await authenticated();
  const [entries, artworks] = await Promise.all([
    db.from("trashed_entries").select("id,entry_date,artwork_id,deleted_at,data").eq("user_id", user.id).order("deleted_at", { ascending: false }).range(0, 999),
    db.from("trashed_artworks").select("id,artwork_date,image_path,deleted_at,data").eq("user_id", user.id).order("deleted_at", { ascending: false }).range(0, 999),
  ]);
  if (entries.error || artworks.error) throw entries.error ?? artworks.error;
  const entryRows = (entries.data ?? []) as Row[], artworkRows = (artworks.data ?? []) as Row[];
  let urls = new Map<string, string | null>();
  try { urls = await signImages(db, artworkRows); } catch { /* the list still works; pictures fall back to their scene */ }
  const bundle = (artworkId: string) => entryRows.filter(e => e.artwork_id === artworkId)
    .sort((a, b) => String(a.data?.created_at ?? "").localeCompare(String(b.data?.created_at ?? "")))
    .map(e => String(e.data?.content ?? ""));
  const items = [
    ...entryRows.filter(e => !e.artwork_id).map(e => ({ id: e.id, kind: "entry", date: e.entry_date, text: String(e.data?.content ?? ""), deletedAt: e.deleted_at, purgeAt: purgeAt(e.deleted_at) })),
    ...artworkRows.map(a => ({ id: a.id, kind: "artwork", date: a.artwork_date, entries: bundle(a.id), imageUrl: (a.image_path && urls.get(a.image_path)) || null,
      frame: a.data?.frame ?? "basic", scene: a.data?.scene ?? "day", deletedAt: a.deleted_at, purgeAt: purgeAt(a.deleted_at) })),
  ].sort(newestFirst);
  return json({ items });
}); }

export function trashRestore(request: Request, id: string) { return run(async () => {
  mutation(request); const { db } = await authenticated(); z.uuid().parse(id);
  const r = await db.rpc("restore_trash_item", { p_id: id }); rpcError(r.error);
  return json({ ok: true, ...(r.data as Row) });
}); }

/** Permanent deletion of one item. A picture's files go first; if that fails the row stays for a retry. */
export function trashPurge(request: Request, id: string) { return run(async () => {
  mutation(request); const { db, user } = await authenticated(); z.uuid().parse(id);
  const art = await db.from("trashed_artworks").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (art.error) throw art.error;
  if (art.data) await removeArtworkFolder(user.id, id);
  const r = await db.rpc("purge_trash_item", { p_id: id }); rpcError(r.error);
  return json({ ok: true });
}); }

/** Empties the trash up to the newest item listed here, so anything trashed meanwhile keeps its files and row. */
export function trashEmpty(request: Request) { return run(async () => {
  mutation(request); const { db, user } = await authenticated();
  const [entries, artworks] = await Promise.all([
    db.from("trashed_entries").select("deleted_at").eq("user_id", user.id).range(0, 999),
    db.from("trashed_artworks").select("id,deleted_at").eq("user_id", user.id).range(0, 999),
  ]);
  if (entries.error || artworks.error) throw entries.error ?? artworks.error;
  const times = [...(entries.data ?? []), ...(artworks.data ?? [])].map(r => String(r.deleted_at));
  if (!times.length) return json({ ok: true, removed: 0 });
  const until = times.reduce((a, b) => (a > b ? a : b));
  for (const art of artworks.data ?? []) await removeArtworkFolder(user.id, art.id);
  const r = await db.rpc("empty_trash", { p_until: until }); rpcError(r.error);
  return json({ ok: true, removed: r.data ?? 0 });
}); }
