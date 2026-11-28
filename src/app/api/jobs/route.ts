import { cronAuthorized } from "@/server/core/http";
import { aiConfigured } from "@/server/core/ai";
import { processOne } from "@/server/core/jobs";
import { purgeExpiredTrash } from "@/server/trash-purge";
export const maxDuration = 300;
export const runtime = "nodejs";
export async function POST(request:Request) {
  if(!cronAuthorized(request)) return new Response("Unauthorized",{status:401});
  // Expired trash is purged on every run, whether or not image AI is set up; it never blocks drawing.
  try { await purgeExpiredTrash(); } catch { console.warn("Trash purge deferred"); }
  if(!aiConfigured()) return Response.json({error:"AI not configured"},{status:503});
  try { return Response.json(await processOne(),{headers:{"Cache-Control":"no-store"}}); }
  catch { return Response.json({error:"Worker failed"},{status:500}); }
}
