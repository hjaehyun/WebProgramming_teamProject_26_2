import { cartoonJob } from "@/server/cartoon-handlers";
import { cronAuthorized } from "@/server/core/http";
import { purgeAllExpiredTrash } from "@/server/trash-purge";
export const runtime = "nodejs";
export const maxDuration = 300;
// The daily cron always runs, while the picture worker is only called when a picture is waiting,
// so expired trash is purged here too. A purge failure never blocks the cartoon work.
async function daily(request: Request) {
  if (cronAuthorized(request)) {
    try { await purgeAllExpiredTrash(); } catch { console.warn("Trash purge deferred"); }
  }
  return cartoonJob(request);
}
export const GET = daily;
export const POST = daily;
