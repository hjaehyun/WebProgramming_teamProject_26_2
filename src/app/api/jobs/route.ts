import { cronAuthorized } from "@/server/core/http";
import { aiConfigured } from "@/server/core/ai";
import { processOne } from "@/server/core/jobs";
export const maxDuration = 300;
export const runtime = "nodejs";
export async function POST(request:Request) {
  if(!cronAuthorized(request)) return new Response("Unauthorized",{status:401});
  if(!aiConfigured()) return Response.json({error:"AI not configured"},{status:503});
  try { return Response.json(await processOne(),{headers:{"Cache-Control":"no-store"}}); }
  catch { return Response.json({error:"Worker failed"},{status:500}); }
}
