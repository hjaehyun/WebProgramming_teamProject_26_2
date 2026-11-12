import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { HttpError } from "./request";
import { accountInfo } from "./oauth";
import { weatherEnabled } from "./weather";

export type Row = Record<string, any>;
export const artworkColumns = "id,user_id,artwork_date,status,art_style,title,scene_summary,image_prompt,image_path,scene,tags,error_message,attempts,last_request_id";
export function toStyle(style: string) { return style === "watercolor" ? "water" : style; }
export function fromStyle(style: string) { return style === "water" ? "watercolor" : style; }
// The weather columns exist only after the entry_weather migration, so they are selected only when the feature is on.
export function entryColumns() { return weatherEnabled() ? "id,content,created_at,entry_date,weather_code,temp_c" : "id,content,created_at,entry_date"; }
export function entryView(row: Row) {
  const weather = row.weather_code && row.temp_c != null ? { weather: row.weather_code, tempC: Number(row.temp_c) } : null;
  return { id: row.id, at: row.created_at, text: row.content, weather };
}
export function artworkView(row: Row, entries: Row[], imageUrl: string | null) {
  return { id: row.id, date: row.artwork_date, scene: row.scene ?? "day", style: toStyle(row.art_style),
    summary: row.scene_summary ?? "", tags: row.tags ?? [], entries: entries.map(entryView), imageUrl, imageError: Boolean(row.image_path && !imageUrl),
    status: row.status, phase: row.status === "processing" ? (row.image_prompt ? "drawing" : "summarizing") : row.status,
    error: row.error_message, attempts: row.attempts, requestId: row.last_request_id ?? null,
    canRetry: row.attempts < 3 && (row.status === "failed" || row.status === "ready"), song: null, mood: null };
}
export async function signImages(db: SupabaseClient, rows: Row[], ttl = 3600) {
  const paths = [...new Set(rows.map(r => r.image_path).filter(Boolean))] as string[];
  if (!paths.length) return new Map<string,string>();
  const { data, error } = await db.storage.from("artworks").createSignedUrls(paths, ttl);
  if (error) throw error;
  return new Map((data ?? []).filter(r => !r.error && r.path && r.signedUrl).map(r => [r.path!, r.signedUrl]));
}
export async function getArtwork(db: SupabaseClient, userId: string, date: string) {
  const [art, entries] = await Promise.all([
    db.from("daily_artworks").select(artworkColumns).eq("user_id", userId).eq("artwork_date", date).maybeSingle(),
    db.from("entries").select(entryColumns()).eq("user_id", userId).eq("entry_date", date).order("created_at"),
  ]);
  if (art.error || entries.error) throw art.error ?? entries.error;
  if (!art.data) throw new HttpError(404, "그림을 찾을 수 없어요.");
  const urls = await signImages(db, [art.data]);
  if (art.data.image_path && !urls.get(art.data.image_path)) throw new HttpError(503,"그림 파일을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
  return artworkView(art.data, entries.data ?? [], urls.get(art.data.image_path) ?? null);
}
async function allEntries(db: SupabaseClient, userId: string) {
  const rows: Row[] = [];
  for (let start = 0; ; start += 1000) {
    const r = await db.from("entries").select(entryColumns()).eq("user_id",userId).order("created_at").order("id").range(start,start+999);
    if (r.error) throw r.error;
    rows.push(...(r.data ?? [])); if ((r.data?.length ?? 0) < 1000) return rows;
  }
}
async function allArtworks(db: SupabaseClient, userId: string) {
  const rows: Row[] = [];
  for (let start = 0; ; start += 1000) {
    const r = await db.from("daily_artworks").select(artworkColumns).eq("user_id",userId).order("artwork_date",{ ascending:false }).range(start,start+999);
    if (r.error) throw r.error;
    rows.push(...(r.data ?? [])); if ((r.data?.length ?? 0) < 1000) return rows;
  }
}
export async function dashboard(db: SupabaseClient, user: User, profile: Row) {
  const account = { email:user.email??"", joinedAt:user.created_at, ...accountInfo(user.identities) };
  const profileInfo = { nick:profile.nickname,style:toStyle(profile.art_style),consent:!!profile.ai_consent_at };
  if (profile.deleting_at) return {
    account,profile:profileInfo,deletionPending:true,drafts:{},artworks:{},
    exhibition:{id:"",title:"나의 하루조각",desc:"",isPublic:false,dates:[]},capabilities:{weather:false,music:false},
  };
  const [entries, art, ex] = await Promise.all([
    allEntries(db,user.id),
    allArtworks(db,user.id),
    db.from("exhibitions").select("id,title,description,is_public").eq("user_id",user.id).order("created_at").order("id").limit(1).maybeSingle(),
  ]);
  if (ex.error) throw ex.error;
  const rows = art; const urls = await signImages(db,rows);
  const artworks = Object.fromEntries(rows.map(a => [a.artwork_date,artworkView(a,entries.filter(e=>e.entry_date===a.artwork_date),urls.get(a.image_path)??null)]));
  const drafts: Record<string,Row[]> = {};
  for (const e of entries) if (!artworks[e.entry_date]) (drafts[e.entry_date] ??= []).push(entryView(e));
  let dates: string[] = [];
  if (ex.data) {
    const items = await db.from("exhibition_items").select("artwork_id,position").eq("exhibition_id",ex.data.id).order("position");
    if (items.error) throw items.error;
    dates = (items.data ?? []).flatMap(i => { const a=rows.find(a=>a.id===i.artwork_id); return a?[a.artwork_date]:[]; });
  }
  return {
    account,
    profile: profile.onboarded ? profileInfo : null,
    deletionPending:false,
    drafts,artworks,
    exhibition: ex.data ? { id:ex.data.id,title:ex.data.title,desc:ex.data.description,isPublic:ex.data.is_public,dates } : {id:"",title:"나의 하루조각",desc:"",isPublic:false,dates:[]},
    capabilities: { weather:weatherEnabled(),music:false },
  };
}
