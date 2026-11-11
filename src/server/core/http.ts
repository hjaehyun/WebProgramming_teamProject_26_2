import "server-only";
import { timingSafeEqual } from "node:crypto";
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_URL || request.url).origin;
  return origin === expected;
}
export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return Boolean(secret && secret.length >= 32 && actual.length === expected.length && timingSafeEqual(actual, expected));
}
