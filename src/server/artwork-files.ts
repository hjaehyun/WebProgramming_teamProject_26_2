import "server-only";
import { adminClient } from "./core/supabase/server";

/** Removes every file in one picture folder (`<user>/<artwork>`) of the private bucket. Throws on any failure. */
export async function removeArtworkFolder(userId: string, artworkId: string) {
  const folder = `${userId}/${artworkId}`;
  const bucket = adminClient().storage.from("artworks");
  const listed = await bucket.list(folder, { limit: 1000 });
  if (listed.error) throw listed.error;
  const files = (listed.data ?? []).filter(item => item.id).map(item => `${folder}/${item.name}`);
  if (files.length) {
    const removed = await bucket.remove(files);
    if (removed.error) throw removed.error;
  }
}
