import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { authenticated, body, HttpError, json, mutation, run } from "./request";
import { dateSchema, seoulDate } from "./core/domain";
import { adminClient } from "./core/supabase/server";
import { cronAuthorized } from "./core/http";
import { cartoonAvailableAt, cartoonPayload, cartoonsEnabled, enqueueCartoon, processDailyCartoon } from "./cartoons";

const editionDate = dateSchema.refine(value => value >= "0001-01-01", "날짜를 확인해 주세요.");

export function cartoonsGet(request: Request) { return run(async () => {
  await authenticated();
  const date = editionDate.parse(new URL(request.url).searchParams.get("date") ?? seoulDate());
  if (date > seoulDate()) throw new HttpError(400, "아직 오지 않은 날짜예요.");
  return json(await cartoonPayload(adminClient(), date));
}); }

export function cartoonsPost(request: Request) { return run(async () => {
  mutation(request);
  await authenticated();
  const input = z.object({ date: editionDate.optional() }).strict().parse(await body(request, 1000));
  const date = input.date ?? seoulDate();
  if (date > seoulDate()) throw new HttpError(400, "아직 오지 않은 날짜예요.");
  if (!cartoonsEnabled()) throw new HttpError(503, "하루만평 연결을 준비하고 있어요.");
  if (Date.now() < Date.parse(cartoonAvailableAt(date))) throw new HttpError(409, "오늘의 만평은 저녁 7시 이후에 준비돼요.");
  await enqueueCartoon(date);
  const payload = await cartoonPayload(adminClient(), date);
  if (payload.canRequest) after(async () => {
    try {
      if (payload.cartoon?.status === "unavailable") await processDailyCartoon(date, true);
      else await processDailyCartoon(date);
    }
    catch { console.warn("[cartoon] background task unavailable", { date }); }
  });
  return json(payload, payload.canRequest || ["queued", "processing"].includes(payload.cartoon?.status ?? "") ? 202 : 200);
}); }

/** Vercel Cron calls GET; POST allows the same secret-protected operational trigger. */
export async function cartoonJob(request: Request) {
  if (!cronAuthorized(request)) return json({ error: "Unauthorized" }, 401);
  if (!cartoonsEnabled()) return json({ error: "Daily cartoon is disabled" }, 503);
  try {
    const date = seoulDate();
    await enqueueCartoon(date);
    return json(await processDailyCartoon(date));
  } catch {
    console.warn("[cartoon] scheduled task unavailable");
    return json({ error: "Daily cartoon task unavailable" }, 503);
  }
}
