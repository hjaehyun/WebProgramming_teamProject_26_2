import "server-only";
import { adminClient } from "./supabase/server";
import { aiConfigured, summarize, illustrate } from "./ai";
import type { Style } from "./domain";

export async function processOne(id?: string) {
  if (!aiConfigured()) throw new Error("AI 연결 설정이 필요해요.");
  const db = adminClient();
  const { data, error } = await db.rpc("claim_artwork", { p_id: id ?? null });
  if (error) throw error;
  const job = data?.[0];
  if (!job) return { processed: false };
  // Token-specific paths fence stale uploads as well as database writes.
  const path = `${job.user_id}/${job.id}/${job.claim_token}.png`;
  let uploaded = false;
  try {
    const scene = job.image_prompt && job.scene_summary && job.title
      ? { image_prompt: job.image_prompt, summary: job.scene_summary, title: job.title, tags: job.tags ?? [], scene: job.scene ?? "day" }
      : await summarize(job.entry_snapshot, job.art_style as Style);
    const checkpoint = await db.from("daily_artworks").update({ title: scene.title, scene_summary: scene.summary, image_prompt: scene.image_prompt, tags: scene.tags ?? [], scene: scene.scene ?? "day" }).eq("id", job.id).eq("claim_token", job.claim_token).eq("status", "processing").select("id").single();
    if (checkpoint.error) throw checkpoint.error;
    const png = await illustrate(scene.image_prompt);
    const { error: uploadError } = await db.storage.from("artworks").upload(path, png, { contentType: "image/png", upsert: false });
    if (uploadError) throw uploadError;
    uploaded = true;
    const { error: saveError } = await db.from("daily_artworks").update({ status: "ready", image_path: path, completed_at: new Date().toISOString(), error_message: null }).eq("id", job.id).eq("claim_token", job.claim_token).eq("status", "processing").select("id").single();
    if (saveError) throw saveError;
    return { processed: true, status: "ready" };
  } catch {
    // A failed HTTP response does not prove the final UPDATE failed to commit.
    // Keep the object until the DB confirms a fenced failure transition.
    try {
      const current = await db.from("daily_artworks").select("status,claim_token,image_path").eq("id", job.id).maybeSingle();
      if (current.error || !current.data) throw new Error("Artwork state could not be verified");
      if (current.data.status === "ready" || current.data.claim_token !== job.claim_token || current.data.status !== "processing") {
        return { processed: true, status: current.data.status };
      }
      const failure = await db.from("daily_artworks")
        .update({ status: "failed", error_message: "그림을 완성하지 못했어요. 잠시 뒤 다시 시도해 주세요." })
        .eq("id", job.id).eq("claim_token", job.claim_token).eq("status", "processing")
        .select("id,image_path").maybeSingle();
      // A concurrent completion/claim, or another lost response, leaves ownership
      // unresolved. Never delete an uploaded object in that case.
      if (failure.error || !failure.data) throw new Error("Artwork failure state could not be verified");
      if (uploaded && failure.data.image_path !== path) {
        try {
          const cleanup = await db.storage.from("artworks").remove([path]);
          if (cleanup.error) console.error("Artwork cleanup deferred", { id: job.id });
        } catch { console.error("Artwork cleanup deferred", { id: job.id }); }
      }
      console.error("Artwork processing failed", { id: job.id, attempt: job.attempts, stateSaved: true });
      return { processed: true, status: "failed" };
    } catch {
      console.error("Artwork reconciliation deferred", { id: job.id, attempt: job.attempts });
      return { processed: true, status: "unknown" };
    }
  }
}
