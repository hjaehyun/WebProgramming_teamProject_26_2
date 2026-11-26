import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiConfigured, illustrate } from "./core/ai";
import { dateSchema, seoulDate } from "./core/domain";
import { adminClient } from "./core/supabase/server";
import { selectCartoonNews } from "./cartoon-news";

export const CARTOON_BUCKET = "news-cartoons";
const LEASE_MS = 10 * 60_000;
const RETRY_MS = 15 * 60_000;
const columns = "cartoon_date,status,stage,headline,summary,selection_reason,caption,sources,image_path,selected_at,completed_at,error_message,attempts,retry_after,claimed_at";
type Row = Record<string, any>;

export function cartoonsEnabled() {
  return process.env.DAILY_CARTOON_ENABLED !== "false" && aiConfigured();
}

export function cartoonAvailableAt(date: string) { return `${date}T22:00:00+09:00`; }

/** Past editions use only articles published on their requested Korean calendar date. */
export function cartoonCanRequest(row: Row | null, date: string, now = new Date()) {
  if (!cartoonsEnabled() || !dateSchema.safeParse(date).success || !Number.isFinite(now.getTime())
    || date < "0001-01-01" || date > seoulDate(now) || now.getTime() < Date.parse(cartoonAvailableAt(date))) return false;
  if (!row) return true;
  if (row.attempts >= 3 || row.status === "ready") return false;
  if (row.status === "processing") return Boolean(row.claimed_at && Date.parse(row.claimed_at) < now.getTime() - LEASE_MS);
  if (row.status === "failed") return Boolean(row.retry_after && Date.parse(row.retry_after) <= now.getTime());
  if (row.status === "unavailable") return row.retry_after == null || Date.parse(row.retry_after) <= now.getTime();
  return row.status === "queued";
}

export async function cartoonPayload(db: SupabaseClient, date: string, now = new Date()) {
  const [current, archive] = await Promise.all([
    db.from("daily_cartoons").select(columns).eq("cartoon_date", date).maybeSingle(),
    db.from("daily_cartoons").select("cartoon_date").order("cartoon_date", { ascending: false }).limit(31),
  ]);
  if (current.error || archive.error) throw current.error ?? archive.error;
  const row: Row | null = current.data;
  let imageUrl: string | null = null;
  if (row?.status === "ready" && typeof row.image_path === "string" && row.image_path.startsWith(`${date}/`)) {
    const signed = await db.storage.from(CARTOON_BUCKET).createSignedUrl(row.image_path, 3600);
    if (!signed.error) imageUrl = signed.data?.signedUrl ?? null;
  }
  const stale = row && (!row.claimed_at || Date.parse(row.claimed_at) < now.getTime() - LEASE_MS);
  const expired = row && stale && ["queued", "processing"].includes(row.status) && row.attempts >= 3;
  return {
    today: seoulDate(now), enabled: cartoonsEnabled(), availableAt: cartoonAvailableAt(date),
    canRequest: cartoonCanRequest(row, date, now),
    dates: (archive.data ?? []).map(r => r.cartoon_date as string),
    cartoon: row ? {
      date: row.cartoon_date, status: expired ? "failed" : row.status, stage: row.stage,
      headline: row.headline, summary: row.summary, selectionReason: row.selection_reason,
      caption: row.caption, sources: row.sources ?? [], imageUrl,
      imageError: Boolean(row.status === "ready" && row.image_path && !imageUrl),
      selectedAt: row.selected_at, completedAt: row.completed_at, retryAt: row.attempts < 3 ? row.retry_after : null,
      attempts: row.attempts, maxAttempts: 3,
      error: expired ? "이날의 만평 생성이 중단됐어요. 생성 시도 횟수를 모두 사용했어요." : row.error_message,
    } : null,
  };
}

export async function enqueueCartoon(date: string) {
  const r = await adminClient().rpc("enqueue_daily_cartoon", { p_date: date });
  if (r.error) throw r.error;
}

/** A DB lease, not a process-local flag, bounds concurrent requests and provider charges. */
export async function processDailyCartoon(date = seoulDate(), retryUnavailable = false) {
  if (!cartoonsEnabled()) return { processed: false, status: "disabled" };
  // Protect direct worker callers as well as the public API: an early run must
  // not consume the shared attempt budget before the evening news is available.
  if (date === seoulDate() && Date.now() < Date.parse(cartoonAvailableAt(date))) return { processed: false, status: "not_due" };
  const db = adminClient();
  const claimed = await db.rpc("claim_daily_cartoon", retryUnavailable ? { p_date: date, p_retry_unavailable: true } : { p_date: date });
  if (claimed.error) throw claimed.error;
  const job: Row | undefined = claimed.data?.[0];
  if (!job) return { processed: false };
  const path = `${job.cartoon_date}/${job.claim_token}.png`;
  let uploaded = false;
  let phase = "searching";
  const update = (values: Row) => db.from("daily_cartoons").update(values)
    .eq("cartoon_date", job.cartoon_date).eq("claim_token", job.claim_token).eq("status", "processing")
    .select("cartoon_date").maybeSingle();
  try {
    let prompt = job.image_prompt;
    if (!prompt) {
      const news = await selectCartoonNews(job.cartoon_date);
      if (!news) {
        const unavailable = await update({ status: "unavailable", completed_at: new Date().toISOString(),
          retry_after: job.attempts < 3 ? new Date(Date.now() + RETRY_MS).toISOString() : null,
          error_message: "선택한 날짜의 방송 선두 기사와 독립 매체의 보도를 충분히 확인하지 못했어요. 다른 기사로 대신 채우지 않았어요." });
        if (unavailable.error) throw unavailable.error;
        return { processed: true, status: unavailable.data ? "unavailable" : "superseded" };
      }
      const saved = await update({ headline: news.headline, summary: news.summary,
        selection_reason: news.selectionReason, caption: news.caption, sources: news.sources,
        selected_at: news.selectedAt, image_prompt: news.imagePrompt, stage: "drawing" });
      if (saved.error) throw saved.error;
      if (!saved.data) return { processed: true, status: "superseded" };
      prompt = news.imagePrompt;
    }
    phase = "drawing";
    const png = await illustrate(prompt);
    const upload = await db.storage.from(CARTOON_BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
    if (upload.error) throw upload.error;
    uploaded = true;
    const saved = await update({ status: "ready", image_path: path, completed_at: new Date().toISOString(), error_message: null, retry_after: null });
    if (saved.error) throw saved.error;
    if (!saved.data) {
      // A stale worker's token-specific image cannot replace the newer worker's image.
      await db.storage.from(CARTOON_BUCKET).remove([path]);
      return { processed: true, status: "superseded" };
    }
    console.info("[cartoon] completed", { date: job.cartoon_date, attempt: job.attempts });
    return { processed: true, status: "ready" };
  } catch {
    // A lost response might be a successful commit. Reconcile before touching the object.
    try {
      const current = await db.from("daily_cartoons").select("status,claim_token,image_path").eq("cartoon_date", job.cartoon_date).maybeSingle();
      if (current.error || !current.data) throw new Error("Cartoon reconciliation unavailable");
      if (current.data.status === "ready" || current.data.claim_token !== job.claim_token || current.data.status !== "processing") {
        return { processed: true, status: current.data.status };
      }
      const failed = await update({ status: "failed", retry_after: new Date(Date.now() + RETRY_MS).toISOString(),
        error_message: job.attempts >= 3 ? "이날의 만평을 완성하지 못했어요. 생성 시도 횟수를 모두 사용했어요."
          : "뉴스 확인 또는 그림 생성이 잠시 지연되고 있어요. 15분 뒤 다시 시도할 수 있어요." });
      if (failed.error || !failed.data) throw new Error("Cartoon failure transition unavailable");
      if (uploaded && current.data.image_path !== path) await db.storage.from(CARTOON_BUCKET).remove([path]);
      console.warn("[cartoon] failed", { date: job.cartoon_date, phase, attempt: job.attempts });
      return { processed: true, status: "failed" };
    } catch {
      console.warn("[cartoon] reconciliation deferred", { date: job.cartoon_date, phase });
      return { processed: true, status: "unknown" };
    }
  }
}
