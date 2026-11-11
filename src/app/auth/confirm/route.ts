import { NextResponse } from "next/server";
import { configured,userClient } from "@/server/core/supabase/server";
import { clearRecovery,grantRecovery } from "@/server/recovery";
export async function GET(request:Request) {
  const url=new URL(request.url),type=url.searchParams.get("type"),token_hash=url.searchParams.get("token_hash");
  const recovery=type==="recovery";
  const go=(path:string)=>{const r=NextResponse.redirect(new URL(path,process.env.APP_URL || url.origin));r.headers.set("Cache-Control","private, no-store");r.headers.set("Referrer-Policy","no-referrer");return r;};
  if(configured() && token_hash && token_hash.length<=2048 && (type==="email" || recovery)) {
    try {
      await clearRecovery();
      const db=await userClient();const {data,error}=await db.auth.verifyOtp({token_hash,type});
      if(!error) {
        if(recovery && data.user && data.session) {await grantRecovery(data.user.id,data.session.access_token);return go("/reset-password");}
        if(!recovery) return go("/today");
      }
    } catch { /* A fixed destination never echoes token hashes or provider errors. */ }
  }
  return go(recovery?"/forgot-password?error=expired":"/?error=confirmation");
}
