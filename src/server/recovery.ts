import "server-only";
import { createHmac,timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./request";

const name="haru_password_recovery";
const options={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/api/auth/reset-password"};
function secret() {
  const value=process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!value) throw new Error("Recovery signing is unavailable");
  return value;
}
function signature(payload:string,key:string) {return createHmac("sha256",key).update(`harujogak:recovery:${payload}`).digest("base64url");}
export function makeGrant(userId:string,sessionId:string,key:string,now=Date.now()) {
  const payload=Buffer.from(JSON.stringify({userId,sessionId,expires:now+10*60*1000})).toString("base64url");
  return `${payload}.${signature(payload,key)}`;
}
export function validGrant(value:string|undefined,userId:string,sessionId:string,key:string,now=Date.now()) {
  if(!value || value.length>2048) return false;
  const [payload,mac,extra]=value.split(".");if(!payload || !mac || extra) return false;
  const actual=Buffer.from(mac);const expected=Buffer.from(signature(payload,key));
  if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return false;
  try {
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    return data.userId===userId && data.sessionId===sessionId && typeof data.expires==="number" && data.expires>now && data.expires<=now+10*60*1000;
  } catch {return false;}
}
export async function grantRecovery(userId:string,verifiedAccessToken:string) {
  // Only called with the session returned by a successful verifyOtp(type=recovery).
  const claims=JSON.parse(Buffer.from(verifiedAccessToken.split(".")[1],"base64url").toString("utf8"));
  if(typeof claims.session_id!=="string") throw new Error("Recovery session missing");
  (await cookies()).set(name,makeGrant(userId,claims.session_id,secret()),{...options,maxAge:600});
}
export async function requireRecovery(db:SupabaseClient,userId:string) {
  const {data,error}=await db.auth.getClaims();
  const sessionId=data?.claims?.session_id;
  if(error || typeof sessionId!=="string" || !validGrant((await cookies()).get(name)?.value,userId,sessionId,secret())) {
    throw new HttpError(403,"재설정 링크가 없거나 만료됐어요. 새 링크를 받아 주세요.");
  }
}
export async function clearRecovery() {(await cookies()).set(name,"",{...options,maxAge:0});}
