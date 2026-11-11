import { NextResponse } from "next/server";
import { configured,userClient } from "@/server/core/supabase/server";
export async function GET(request:Request) {
  const url=new URL(request.url),code=url.searchParams.get("code");
  const go=(path:string)=>{const r=NextResponse.redirect(new URL(path,process.env.APP_URL || url.origin));r.headers.set("Cache-Control","private, no-store");r.headers.set("Referrer-Policy","no-referrer");return r;};
  if(configured() && code) {
    try { const db=await userClient();const {error}=await db.auth.exchangeCodeForSession(code);if(!error) return go("/today"); }
    catch { /* The user can still sign in with their password after email confirmation. */ }
  }
  return go("/?error=confirmation");
}
