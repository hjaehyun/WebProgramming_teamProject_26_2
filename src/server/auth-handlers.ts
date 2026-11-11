import "server-only";
import { z } from "zod";
import { configured,userClient,adminClient,statelessClient } from "./core/supabase/server";
import { authenticated,body,HttpError,json,mutation,rpcError,run } from "./request";
import { dashboard,fromStyle } from "./data";
import { accountInfo } from "./oauth";
import { clearRecovery,requireRecovery } from "./recovery";

const credentials=z.object({email:z.string().trim().pipe(z.email()),password:z.string().min(8).max(128)});
export function auth(request: Request, mode: "signup"|"login"|"logout") { return run(async()=>{
  mutation(request); if(!configured()) throw new HttpError(503,"서비스 연결 설정이 필요해요.");
  const db=await userClient();
  if(mode==="logout") { const {error}=await db.auth.signOut({scope:"local"}); if(error) throw error; await clearRecovery(); return json({ok:true}); }
  const input=credentials.parse(await body(request));
  if(mode==="signup") {
    const origin=process.env.APP_URL; if(!origin) throw new HttpError(503,"인증 주소 설정이 필요해요.");
    const {data,error}=await db.auth.signUp({...input,options:{emailRedirectTo:new URL("/auth/callback",origin).href}});
    if(error) throw new HttpError(error.status===429?429:503,"가입 인증을 진행하지 못했어요. 잠시 후 다시 시도해 주세요. 계속되면 메일 발송 설정을 확인해 주세요.");
    return json({ok:true,confirm:!data.session});
  }
  await clearRecovery();
  const {error}=await db.auth.signInWithPassword(input);
  if(error) throw new HttpError(401,"이메일·비밀번호와 이메일 인증 상태를 확인해 주세요.");
  return json({ok:true});
}); }
export function me() { return run(async()=>{const {db,user,profile}=await authenticated(true);return json(await dashboard(db,user,profile));}); }
export function profilePut(request:Request) { return run(async()=>{
  mutation(request);const {db,user}=await authenticated();
  const p=z.object({nick:z.string().trim().min(1).max(30),style:z.enum(["water","pencil","crayon","story","gouache"]),consent:z.boolean()}).parse(await body(request));
  const {error}=await db.from("profiles").update({nickname:p.nick,art_style:fromStyle(p.style),ai_consent_at:p.consent?new Date().toISOString():null,onboarded:true}).eq("id",user.id);
  if(error) throw error;return json({ok:true});
}); }
async function checkPassword(email:string,password:string) {
  const db=statelessClient();
  const {error}=await db.auth.signInWithPassword({email,password});
  if(error) throw new HttpError(403,"현재 비밀번호를 확인해 주세요.");
  await db.auth.signOut({scope:"local"});
}
export function passwordPut(request:Request) { return run(async()=>{
  mutation(request);const {db,user}=await authenticated();
  const p=z.object({current:z.string().min(1).max(128),next:z.string().min(8).max(128)}).parse(await body(request));
  if(!user.email || accountInfo(user.identities).kind!=="email") throw new HttpError(400,"이메일 계정에서만 비밀번호를 바꿀 수 있어요.");
  await checkPassword(user.email,p.current);
  const {error}=await db.auth.updateUser({password:p.next}); if(error) throw error;
  await db.auth.signOut({scope:"others"});return json({ok:true});
}); }
export function accountDelete(request:Request) { return run(async()=>{
  mutation(request);const {db,user}=await authenticated(true);const p=z.object({password:z.string().max(128).optional(),confirm:z.string().optional()}).parse(await body(request));
  if(accountInfo(user.identities).kind==="email") await checkPassword(user.email!,z.string().min(1).max(128).parse(p.password));
  else if(p.confirm!=="탈퇴") throw new HttpError(400,"탈퇴 확인 문구를 입력해 주세요.");
  const start=await db.rpc("begin_account_deletion");rpcError(start.error);
  const admin=adminClient();const bucket=admin.storage.from("artworks");const pending=[user.id];const files:string[]=[];
  while(pending.length) {
    const folder=pending.pop()!;
    for(let offset=0;;offset+=1000) {
      const r=await bucket.list(folder,{limit:1000,offset,sortBy:{column:"name",order:"asc"}});if(r.error) throw r.error;
      for(const item of r.data??[]) { const path=`${folder}/${item.name}`;if(item.id) files.push(path);else pending.push(path); }
      if((r.data?.length??0)<1000) break;
    }
  }
  for(let start=0;start<files.length;start+=100) {const r=await bucket.remove(files.slice(start,start+100));if(r.error) throw r.error;}
  // No account deletion until every listed file removal has succeeded. A retry can finish partial cleanup.
  const deleted=await admin.auth.admin.deleteUser(user.id);if(deleted.error) throw deleted.error;
  await db.auth.signOut({scope:"local"});return json({ok:true});
}); }
export function forgotPassword(request:Request) { return run(async()=>{
  mutation(request);const p=z.object({email:z.string().trim().pipe(z.email())}).parse(await body(request));
  const db=await userClient();
  await db.auth.resetPasswordForEmail(p.email,{redirectTo:new URL("/reset-password",process.env.APP_URL!).href});
  return json({message:"재설정 가능한 계정이라면 안내 메일을 보냈어요. 메일함을 확인해 주세요."});
}); }
export function resetPassword(request:Request) { return run(async()=>{
  mutation(request);const {db,user}=await authenticated();const p=z.object({password:z.string().min(8).max(128)}).parse(await body(request));
  await requireRecovery(db,user.id);
  const {error}=await db.auth.updateUser({password:p.password});if(error) throw error;
  await clearRecovery();await db.auth.signOut({scope:"global"});return json({ok:true});
}); }
