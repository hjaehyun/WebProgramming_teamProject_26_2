import "server-only";
import { z } from "zod";
import { configured, userClient } from "./core/supabase/server";
import { sameOrigin } from "./core/http";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
export async function run(action: () => Promise<Response>) {
  try { return await action(); }
  catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError) return json({ error: "입력 내용을 확인해 주세요." }, 400);
    // Provider errors, tokens and journal text never go into responses or logs.
    return json({ error: "요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요." }, 503);
  }
}
export function mutation(request: Request) {
  if (!sameOrigin(request)) throw new HttpError(403, "요청 출처를 확인해 주세요.");
}
export async function body(request: Request, max = 20000) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "입력 내용을 확인해 주세요.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > max) { await reader.cancel(); throw new HttpError(413, "입력 내용이 너무 길어요."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "입력 내용을 확인해 주세요."); }
}
export async function authenticated(allowDeleting = false) {
  if (!configured()) throw new HttpError(503, "서비스 연결 설정이 필요해요.");
  const db = await userClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "로그인이 필요해요.");
  const profile = await db.from("profiles").select("*").eq("id", data.user.id).single();
  if (profile.error) throw profile.error;
  if (profile.data.deleting_at && !allowDeleting) throw new HttpError(409, "탈퇴 정리가 진행 중이에요. 탈퇴를 다시 시도해 주세요.");
  return { db, user: data.user, profile: profile.data };
}
export function rpcError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "P0001") throw new HttpError(409, error.message ?? "요청 상태를 확인해 주세요.");
  throw error;
}
