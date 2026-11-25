import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { authenticated, body, HttpError, json, mutation, rpcError, run } from "./request";
import { dateSchema, seoulDate } from "./core/domain";
import { adminClient } from "./core/supabase/server";
import { cronAuthorized } from "./core/http";
import { connectionPayload, connectionsEnabled, processConnection } from "./connections";

const connectionDate = dateSchema.refine(value => value >= "0001-01-01", "날짜를 확인해 주세요.");

function resume(id: string | null) {
  if (id) after(async () => {
    try { await processConnection(id); }
    catch { console.warn("[connection] background phase unavailable"); }
  });
}
export function connectionsGet(request: Request) { return run(async () => {
  const { user, profile } = await authenticated();
  const date = connectionDate.parse(new URL(request.url).searchParams.get("date") ?? seoulDate());
  if (date > seoulDate()) throw new HttpError(400, "아직 오지 않은 날짜예요.");
  const { payload, workId } = await connectionPayload(adminClient(), user.id, date, Boolean(profile.ai_consent_at));
  resume(workId);
  return json(payload);
}); }

export function connectionsPost(request: Request) { return run(async () => {
  mutation(request);
  const { db, user, profile } = await authenticated();
  const p = z.object({ date: connectionDate, refresh: z.boolean().default(false), requestId: z.uuid() }).strict().parse(await body(request, 1000));
  if (p.date > seoulDate()) throw new HttpError(400, "아직 오지 않은 날짜예요.");
  if (!profile.ai_consent_at) throw new HttpError(409, "AI 전송 동의가 필요해요. 설정에서 확인해 주세요.");
  if (!connectionsEnabled()) throw new HttpError(503, "하루연결 준비 중이에요. 잠시 후 다시 찾아주세요.");
  const result = await db.rpc("request_daily_connection", { p_date: p.date, p_refresh: p.refresh, p_request_id: p.requestId });
  rpcError(result.error);
  const { payload, workId } = await connectionPayload(adminClient(), user.id, p.date, true);
  resume(workId);
  return json(payload, ["queued", "processing"].includes(payload.connection?.status ?? "") ? 202 : 200);
}); }

export async function connectionJob(request: Request) {
  if (!cronAuthorized(request)) return json({ error: "Unauthorized" }, 401);
  if (!connectionsEnabled()) return json({ error: "Connection generation disabled" }, 503);
  try { return json(await processConnection()); }
  catch { console.warn("[connection] worker unavailable"); return json({ error: "Connection worker unavailable" }, 503); }
}
