import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "./core/supabase/server";
import { dateSchema, moods, type Mood } from "./core/domain";
import { authenticated, body, HttpError, json, mutation, rpcError, run } from "./request";
import { SONG_LIST } from "./song-list";

// Songs for finished pictures: a hand-picked list per mood (song-list.ts), kept in the shared
// song_pool table. The YouTube Data API v3 is used only to check that the listed videos are still
// public and embeddable (videos.list, 1 quota unit per 50 ids; no search). YouTube receives the listed
// video ids and nothing else: no journal text, summary, tag, mood or account data. The API key travels
// in a request header, never in a URL, so it cannot end up in request logs or error messages.

export type Song = { video_id: string; title: string; channel: string };

const API = "https://www.googleapis.com/youtube/v3/videos";
const TIMEOUT_MS = 4000;
const SYNC_EVERY_MS = 24 * 3600_000;
const RETRY_AFTER_MS = 10 * 60_000;

/** Parses the "[mood]" / "videoId | 곡 | 채널" list. Malformed lines and unknown moods are ignored. */
export function parseSongList(text: string): Record<Mood, Song[]> {
  const list = Object.fromEntries(moods.map(m => [m, [] as Song[]])) as Record<Mood, Song[]>;
  let mood: Mood | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim(), header = line.match(/^\[(\w+)\]$/);
    if (header) { mood = (moods as readonly string[]).includes(header[1]) ? header[1] as Mood : null; continue; }
    const [video_id, title, channel, ...rest] = line.split("|").map(part => part.trim());
    if (!mood || rest.length || !/^[A-Za-z0-9_-]{11}$/.test(video_id) || !title || title.length > 200 || (channel?.length ?? 0) > 200) continue;
    if (!list[mood].some(s => s.video_id === video_id)) list[mood].push({ video_id, title, channel: channel ?? "" });
  }
  return list;
}
export const SONGS = parseSongList(SONG_LIST);

/**
 * On only when the server has a YouTube key and the service key used to write the shared pool.
 * Apply the artwork_songs migration as well; until then song requests fail and capabilities.music stays false.
 */
export function musicEnabled() {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim() && (process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()));
}

/** videos.list, 50 ids per request: the ids that are still public and embeddable. */
export async function playableIds(ids: string[]): Promise<Set<string>> {
  const chunks = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50));
  const playable = new Set<string>();
  await Promise.all(chunks.map(async chunk => {
    const query = new URLSearchParams({ part: "status", id: chunk.join(","), maxResults: "50" });
    const response = await fetch(`${API}?${query}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "X-Goog-Api-Key": process.env.YOUTUBE_API_KEY!.trim() } });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data?.items)) {
      // Never log the key or the response body.
      console.warn("[music] YouTube request failed", { status: response.status, reason: data?.error?.errors?.[0]?.reason ?? null });
      throw new Error("YouTube request failed");
    }
    for (const item of data.items) if (item?.status?.privacyStatus === "public" && item.status.embeddable === true && typeof item.id === "string") playable.add(item.id);
  }));
  return playable;
}

/** Makes song_pool equal to "the listed songs YouTube can still play", and stamps them as checked now. */
async function sync(db: SupabaseClient, now: Date) {
  // The last check is read from the table, so new server instances (cold starts) do not each spend
  // YouTube quota: at most one check a day in total, however many requests or instances there are.
  const newest = await db.from("song_pool").select("fetched_at").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  if (newest.error) throw newest.error;
  if (newest.data && now.getTime() - Date.parse(newest.data.fetched_at) < SYNC_EVERY_MS) return;
  const listed = moods.flatMap(mood => SONGS[mood].map(song => ({ mood, ...song })));
  const ids = [...new Set(listed.map(s => s.video_id))];
  const playable = await playableIds(ids);
  // Deleting a pool row detaches the song from every picture that has it, so a suspicious answer
  // (most of the list "gone" at once) is treated as a fault and changes nothing.
  if (playable.size * 2 < ids.length) throw new Error("YouTube returned too few videos");
  const keep = listed.filter(s => playable.has(s.video_id));
  const saved = await db.from("song_pool").upsert(keep.map(s => ({ ...s, fetched_at: now.toISOString() })), { onConflict: "mood,video_id" });
  if (saved.error) throw saved.error;
  const stored = await db.from("song_pool").select("id,mood,video_id").limit(5000);
  if (stored.error) throw stored.error;
  const kept = new Set(keep.map(s => `${s.mood}:${s.video_id}`));
  const gone = stored.data.filter(r => !kept.has(`${r.mood}:${r.video_id}`)).map(r => r.id);
  if (gone.length) {
    // Deleting a pool row also detaches it from the pictures that had it (they can pick again).
    const removed = await db.from("song_pool").delete().in("id", gone);
    if (removed.error) throw removed.error;
  }
}

// Per server instance: one sync at a time, at most daily, and no retry storm while YouTube is failing.
let running: Promise<void> | null = null;
let syncedAt = -Infinity, failedAt = -Infinity;

/**
 * Brings the pool up to date with the list and YouTube when that is due. Rejects when the check could
 * not be done; callers may still pick from what is stored (rows checked within 30 days stay usable).
 */
export function ensurePool(now = new Date()): Promise<void> {
  const t = now.getTime();
  if (running) return running;
  if (t - syncedAt < SYNC_EVERY_MS) return Promise.resolve();
  if (t - failedAt < RETRY_AFTER_MS) return Promise.reject(new Error("YouTube recently failed"));
  running = Promise.resolve().then(() => sync(adminClient(), now))
    .then(() => { syncedAt = t; }, e => { failedAt = t; throw e; })
    .finally(() => { running = null; });
  return running;
}
/** Test hook. */
export function resetMusicState() { running = null; syncedAt = failedAt = -Infinity; }

// --- API routes ---

const OFF="노래 추천은 아직 연결 준비 중이에요.";
const songSchema=z.object({id:z.number(),videoId:z.string(),title:z.string(),channel:z.string()});
const pickSchema=z.object({song:songSchema.nullable(),unchanged:z.boolean(),refill:z.string().nullable()});

// POST /api/me/artworks/[date]/song  {reroll?} -> {song, unchanged}
// The choice is made in the database (pick_song) from the shared pool for the picture's mood.
export function songPost(request:Request,date:string) {return run(async()=>{
  mutation(request);const {db}=await authenticated();
  dateSchema.parse(date);
  const p=z.object({reroll:z.boolean().default(false)}).parse(await body(request));
  if(!musicEnabled()) throw new HttpError(501,OFF);
  // A failed YouTube check only matters when nothing usable is stored (refill below).
  await ensurePool().catch(()=>{});
  const r=await db.rpc("pick_song",{p_date:date,p_reroll:p.reroll});rpcError(r.error);
  const picked=pickSchema.parse(r.data);
  if(picked.refill) throw new HttpError(503,"지금은 노래를 찾지 못했어요. 잠시 후 다시 시도해 주세요.");
  return json({song:picked.song,unchanged:picked.unchanged});
});}

// POST /api/me/songs/[id]/feedback  {vote: 1|-1} -> {ok:true}
export function songFeedbackPost(request:Request,id:string) {return run(async()=>{
  mutation(request);const {db}=await authenticated();
  const song=z.string().regex(/^[1-9]\d{0,14}$/).transform(Number).parse(id);
  const p=z.object({vote:z.union([z.literal(1),z.literal(-1)])}).parse(await body(request));
  if(!musicEnabled()) throw new HttpError(501,OFF);
  const r=await db.rpc("vote_song",{p_song:song,p_vote:p.vote});rpcError(r.error);
  return json({ok:true});
});}
