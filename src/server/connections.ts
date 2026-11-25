import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiConfigured, illustrate } from "./core/ai";
import { seoulDate } from "./core/domain";
import { adminClient } from "./core/supabase/server";
import { CONNECTION_TOPICS, connectionNewsWindow, extractConnectionTopics, selectConnectionNews, type ConnectionTopic } from "./connection-news";

type Row = Record<string, any>;
const LEASE_MS = 10 * 60_000;
const RETRY_MS = 5 * 60_000;
const columns = "id,user_id,entry_date,status,stage,input_fingerprint,topics,headline,summary,connection_reason,caption,sources,image_path,selected_at,news_from,news_to,completed_at,error_message,attempts,retry_after,claimed_at";
export const CONNECTION_BUCKET = "artworks";
export function connectionsEnabled() { return process.env.DAILY_CONNECTION_ENABLED !== "false" && aiConfigured(); }
const fresh = (row: Row, now: Date) => Boolean(row.claimed_at && Date.parse(row.claimed_at) >= now.getTime() - LEASE_MS);

// Compare with the search's original clock so a same-day result does not become
// obsolete just because its newsTo was capped before the current time.
function matchesNewsWindow(row: Row, now: Date) {
  const selected = new Date(row.selected_at ?? "");
  if (!Number.isFinite(selected.getTime()) || selected.getTime() > now.getTime()) return false;
  try {
    const expected = connectionNewsWindow(row.entry_date, selected);
    return Date.parse(row.news_from) === Date.parse(expected.newsFrom) && Date.parse(row.news_to) === Date.parse(expected.newsTo);
  } catch { return false; }
}

export function connectionControls(row: Row | null, input: { enabled: boolean; consent: boolean; hasEntries: boolean; attempts: number }, now = new Date()) {
  let blockedReason: string | null = null;
  let retryAt: string | null = null;
  if (!input.enabled) blockedReason = "하루연결 준비 중이에요. 잠시 후 다시 찾아주세요.";
  else if (!input.consent) blockedReason = "AI 전송에 동의하면 내 기록과 뉴스를 연결할 수 있어요.";
  else if (!input.hasEntries) blockedReason = "이날의 조각글을 먼저 남겨 주세요.";
  else if (row?.status === "queued" || row?.status === "processing") blockedReason = "뉴스를 연결하고 있어요. 화면을 닫아도 작업은 이어져요.";
  else if (row?.status === "cancelled" && fresh(row, now)) {
    blockedReason = "취소한 작업을 정리하고 있어요. 잠시 후 다시 시도해 주세요.";
    retryAt = new Date(Date.parse(row.claimed_at) + LEASE_MS + 1000).toISOString();
  } else if (input.attempts >= 3) blockedReason = "이날의 하루연결은 실패를 포함해 총 3회까지 만들 수 있어요.";
  else if (row?.status === "failed" && row.retry_after && Date.parse(row.retry_after) > now.getTime()) {
    blockedReason = "잠시 후 다시 연결할 수 있어요."; retryAt = row.retry_after;
  }
  const complete = row && ["ready", "no_match"].includes(row.status);
  return { canRequest: !blockedReason && !complete, canRefresh: !blockedReason && Boolean(complete), blockedReason, retryAt };
}

/** The caller supplies only the ID returned by authenticated(), never a request-body account ID. */
export async function connectionPayload(db: SupabaseClient, userId: string, date: string, consent: boolean, now = new Date()) {
  const [current, archive, input, deleted] = await Promise.all([
    db.from("daily_connections").select(columns).eq("user_id", userId).eq("entry_date", date).maybeSingle(),
    db.from("daily_connections").select("entry_date").eq("user_id", userId).order("entry_date", { ascending: false }).limit(120),
    db.rpc("current_connection_input", { p_user: userId, p_date: date }),
    db.from("deleted_connection_attempts").select("attempts").eq("user_id", userId).eq("entry_date", date).maybeSingle(),
  ]);
  if (current.error || archive.error || input.error || deleted.error) throw current.error ?? archive.error ?? input.error ?? deleted.error;
  const row: Row | null = current.data;
  const window = connectionNewsWindow(date, now);
  const hasEntries = Array.isArray(input.data?.entry_snapshot) && input.data.entry_snapshot.length > 0;
  const enabled = connectionsEnabled();
  const exhausted = Boolean(row?.status === "processing" && !fresh(row, now) && row.attempts >= 3);
  const viewRow = exhausted ? { ...row, status: "failed" } : row;
  const controls = connectionControls(viewRow, { enabled, consent, hasEntries, attempts: row?.attempts ?? deleted.data?.attempts ?? 0 }, now);
  let imageUrl: string | null = null;
  if (row?.status === "ready" && isConnectionPath(row.image_path, userId, row.id)) {
    const signed = await db.storage.from(CONNECTION_BUCKET).createSignedUrl(row.image_path, 3600);
    if (!signed.error) imageUrl = signed.data?.signedUrl ?? null;
  }
  const topics = (Array.isArray(row?.topics) ? row.topics : []).filter((code: unknown): code is ConnectionTopic => typeof code === "string" && Object.hasOwn(CONNECTION_TOPICS, code))
    .map((code: ConnectionTopic) => ({ code, label: CONNECTION_TOPICS[code].label }));
  return {
    // Only previously requested work is resumed by a GET; it never creates a new connection.
    workId: enabled && consent && row && (row.status === "queued" || (row.status === "processing" && !fresh(row, now))) ? row.id as string : null,
    payload: {
      today: seoulDate(now), date, enabled, consent, hasEntries, ...window, ...controls,
      dates: (archive.data ?? []).map(r => r.entry_date as string),
      connection: row ? {
        id: row.id, date: row.entry_date, status: viewRow!.status, stage: row.stage, topics,
        headline: row.headline, summary: row.summary, connectionReason: row.connection_reason, caption: row.caption,
        sources: row.sources ?? [], imageUrl, imageError: Boolean(row.status === "ready" && !imageUrl),
        selectedAt: row.selected_at, newsFrom: row.selected_at ? row.news_from : window.newsFrom,
        newsTo: row.selected_at ? row.news_to : window.newsTo, completedAt: row.completed_at,
        rangeChanged: ["ready", "no_match"].includes(row.status) && !matchesNewsWindow(row, now),
        attempts: row.attempts, maxAttempts: 3, sourceChanged: input.data?.input_fingerprint !== row.input_fingerprint,
        error: exhausted ? "연결 작업이 중단됐고 이날의 생성 횟수를 모두 사용했어요." : row.error_message,
      } : null,
    },
  };
}

function isConnectionPath(path: unknown, userId: string, id: string): path is string {
  return typeof path === "string" && path.startsWith(`${userId}/connection-${id}/`) && /^[a-f0-9-]+\.png$/i.test(path.slice(path.lastIndexOf("/") + 1))
    && path.split("/").length === 3;
}

/** One bounded phase per invocation: research (< 130s) and illustration (< 180s) have separate leases. */
export async function processConnection(id?: string) {
  if (!connectionsEnabled()) return { processed: false, status: "disabled" };
  const db = adminClient();
  const claimed = await db.rpc("claim_daily_connection", { p_id: id ?? null });
  if (claimed.error) throw claimed.error;
  const job: Row | undefined = claimed.data?.[0];
  if (!job) return { processed: false };
  const path = `${job.user_id}/connection-${job.id}/${job.claim_token}.png`;
  const update = (values: Row) => db.from("daily_connections").update(values)
    .eq("id", job.id).eq("user_id", job.user_id).eq("claim_token", job.claim_token).eq("status", "processing")
    .select("id,status,image_path").maybeSingle();
  const current = () => db.from("daily_connections").select("id,status,claim_token,claimed_at,image_path").eq("id", job.id).eq("user_id", job.user_id).maybeSingle();
  const active = async () => {
    const [row, profile] = await Promise.all([current(), db.from("profiles").select("ai_consent_at,deleting_at").eq("id", job.user_id).maybeSingle()]);
    if (row.error || profile.error) throw row.error ?? profile.error;
    return Boolean(row.data?.status === "processing" && row.data.claim_token === job.claim_token && profile.data?.ai_consent_at && !profile.data.deleting_at);
  };
  const removeOwn = async (value: unknown) => {
    if (!isConnectionPath(value, job.user_id, job.id)) return;
    const removed = await db.storage.from(CONNECTION_BUCKET).remove([value]);
    if (removed.error) console.warn("[connection] object cleanup deferred");
  };
  const releaseCancelled = async () => {
    // A cancelled worker has no remaining external work after reaching this point. Never release a newer lease.
    if (job.claimed_at) await db.from("daily_connections").update({ claimed_at: null })
      .eq("id", job.id).eq("user_id", job.user_id).eq("status", "cancelled").eq("claimed_at", job.claimed_at).select("id").maybeSingle();
  };
  let uploaded = false;
  try {
    if (!await active()) { await releaseCancelled(); return { processed: true, status: "cancelled" }; }
    const drawingCheckpoint = job.stage === "drawing" && Boolean(job.image_prompt);
    if (!drawingCheckpoint || !matchesNewsWindow(job, new Date())) {
      // A checkpoint from the former latest-news policy has no private snapshot
      // left. Reuse only its public topic codes, then research the requested month.
      const { topics } = drawingCheckpoint
        ? { topics: (Array.isArray(job.topics) ? job.topics : []).filter((code: unknown): code is ConnectionTopic => typeof code === "string" && Object.hasOwn(CONNECTION_TOPICS, code)) }
        : await extractConnectionTopics({ entries: job.entry_snapshot, artworkSummary: job.artwork_summary, artworkTags: job.artwork_tags ?? [] });
      if (!await active()) { await releaseCancelled(); return { processed: true, status: "cancelled" }; }
      const topicSaved = await update({ topics, stage: "searching" });
      if (topicSaved.error) throw topicSaved.error;
      if (!topicSaved.data) return { processed: true, status: "superseded" };
      if (!await active()) { await releaseCancelled(); return { processed: true, status: "cancelled" }; }
      const now = new Date();
      const news = topics.length ? await selectConnectionNews(topics, job.entry_date, now) : null;
      if (!await active()) { await releaseCancelled(); return { processed: true, status: "cancelled" }; }
      const window = connectionNewsWindow(job.entry_date, now);
      if (!news) {
        const saved = await update({ status: "no_match", topics, selected_at: now.toISOString(), news_from: window.newsFrom, news_to: window.newsTo,
          completed_at: now.toISOString(), claimed_at: null, claim_token: null, entry_snapshot: [], artwork_summary: null, artwork_tags: [],
          headline: null, summary: null, connection_reason: null, caption: null, sources: [], image_prompt: null,
          image_path: null, error_message: "일기 날짜 기준 이전 한 달의 보도에서 기록과 충분히 관련 있는 뉴스를 찾지 못했어요." });
        if (saved.error) throw saved.error;
        if (saved.data) await removeOwn(job.image_path);
        return { processed: true, status: saved.data ? "no_match" : "superseded" };
      }
      const saved = await update({ status: "queued", stage: "drawing", claim_token: null, claimed_at: null,
        topics: news.topics, headline: news.headline, summary: news.summary, connection_reason: news.connectionReason, caption: news.caption,
        sources: news.sources, selected_at: news.selectedAt, news_from: news.newsFrom, news_to: news.newsTo, image_prompt: news.imagePrompt,
        entry_snapshot: [], artwork_summary: null, artwork_tags: [], error_message: null });
      if (saved.error) throw saved.error;
      return { processed: true, status: saved.data ? "queued" : "superseded" };
    }
    const png = await illustrate(job.image_prompt);
    if (!await active()) { await releaseCancelled(); return { processed: true, status: "cancelled" }; }
    const upload = await db.storage.from(CONNECTION_BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
    if (upload.error) throw upload.error;
    uploaded = true;
    if (!await active()) { await removeOwn(path); await releaseCancelled(); return { processed: true, status: "superseded" }; }
    const saved = await update({ status: "ready", image_path: path, completed_at: new Date().toISOString(), error_message: null, retry_after: null,
      claimed_at: null, entry_snapshot: [], artwork_summary: null, artwork_tags: [] });
    if (saved.error) throw saved.error;
    if (!saved.data) { await removeOwn(path); await releaseCancelled(); return { processed: true, status: "superseded" }; }
    if (job.image_path !== path) await removeOwn(job.image_path);
    return { processed: true, status: "ready" };
  } catch {
    // A lost response can mean the write committed. Read before discarding any object or checkpoint.
    try {
      const state = await current();
      if (state.error) throw state.error;
      if (!state.data || state.data.status !== "processing" || state.data.claim_token !== job.claim_token) {
        if (uploaded && state.data?.image_path !== path) await removeOwn(path);
        await releaseCancelled();
        return { processed: true, status: state.data?.status ?? "superseded" };
      }
      const failed = await update({ status: "failed", retry_after: new Date(Date.now() + RETRY_MS).toISOString(), claimed_at: null,
        entry_snapshot: [], artwork_summary: null, artwork_tags: [],
        error_message: job.attempts >= 3 ? "이날의 하루연결 생성 횟수를 모두 사용했어요." : "뉴스 확인이나 그림 생성이 지연되고 있어요. 5분 뒤 다시 시도해 주세요." });
      if (failed.error || !failed.data) throw failed.error ?? new Error("Connection transition superseded");
      if (uploaded && failed.data.image_path !== path) await removeOwn(path);
      console.warn("[connection] phase failed", { stage: job.stage, attempt: job.attempts });
      return { processed: true, status: "failed" };
    } catch {
      console.warn("[connection] reconciliation deferred", { stage: job.stage });
      return { processed: true, status: "unknown" };
    }
  }
}
