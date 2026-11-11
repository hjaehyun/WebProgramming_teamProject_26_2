import "server-only";
import {z} from "zod";
import {authenticated,body,HttpError,json,mutation,rpcError,run} from "./request";
import {dateSchema} from "./core/domain";
import {adminClient,userClient} from "./core/supabase/server";
export function exhibitionPatch(request:Request) {return run(async()=>{
  mutation(request);const {db}=await authenticated();
  const p=z.object({dates:z.array(dateSchema).max(100).optional(),isPublic:z.boolean().optional()}).refine(v=>v.dates!==undefined||v.isPublic!==undefined).parse(await body(request));
  if(p.dates && new Set(p.dates).size!==p.dates.length) throw new HttpError(400,"같은 그림은 한 번만 선택해 주세요.");
  const r=await db.rpc("save_team_exhibition",{p_dates:p.dates??null,p_public:p.isPublic??null});rpcError(r.error);
  return json({ok:true,id:r.data});
});}
export function exhibitionGet(id:string) {return run(async()=>{
  if(!z.uuid().safeParse(id).success) throw new HttpError(404,"전시를 찾을 수 없어요.");
  const db=adminClient();
  const ex=await db.from("exhibitions").select("id,user_id,title,description,is_public").eq("id",id).maybeSingle();
  if(ex.error) throw ex.error;
  if(!ex.data) throw new HttpError(404,"전시를 찾을 수 없어요.");
  if(!ex.data.is_public) {
    const own=await userClient();const {data}=await own.auth.getUser();
    if(data.user?.id!==ex.data.user_id) throw new HttpError(404,"전시를 찾을 수 없어요.");
  }
  const [items,profile]=await Promise.all([
    db.from("exhibition_items").select("artwork_id,position,caption").eq("exhibition_id",id).order("position"),
    db.from("profiles").select("nickname,deleting_at").eq("id",ex.data.user_id).single(),
  ]);
  if(items.error||profile.error) throw items.error??profile.error;
  if(profile.data.deleting_at) throw new HttpError(404,"전시를 찾을 수 없어요.");
  const ids=(items.data??[]).map(i=>i.artwork_id);
  const art=ids.length?await db.from("daily_artworks").select("id,artwork_date,scene,image_path,scene_summary").eq("user_id",ex.data.user_id).eq("status","ready").in("id",ids):{data:[],error:null};
  if(art.error) throw art.error;
  return json({id:ex.data.id,title:ex.data.title,desc:ex.data.description,isPublic:ex.data.is_public,ownerNick:profile.data.nickname,
    items:(items.data??[]).flatMap(i=>{const a=art.data?.find(a=>a.id===i.artwork_id);return a?[{date:a.artwork_date,scene:a.scene,imageUrl:a.image_path?`/api/exhibitions/${id}/images/${a.artwork_date}`:null,summary:a.scene_summary??"",note:i.caption||null,song:null}]:[];})});
});}

// Public image links contain neither user IDs nor bearer tokens. Recheck publication
// on every request, so turning a show private also closes its existing image links.
export function exhibitionImageGet(id:string,date:string) {return run(async()=>{
  if(!z.uuid().safeParse(id).success || !dateSchema.safeParse(date).success) throw new HttpError(404,"그림을 찾을 수 없어요.");
  const db=adminClient();
  const ex=await db.from("exhibitions").select("user_id,is_public").eq("id",id).maybeSingle();
  if(ex.error) throw ex.error;
  if(!ex.data) throw new HttpError(404,"그림을 찾을 수 없어요.");
  if(!ex.data.is_public) {
    const owner=await userClient();const {data}=await owner.auth.getUser();
    if(data.user?.id!==ex.data.user_id) throw new HttpError(404,"그림을 찾을 수 없어요.");
  }
  const profile=await db.from("profiles").select("deleting_at").eq("id",ex.data.user_id).maybeSingle();
  if(profile.error) throw profile.error;
  if(!profile.data || profile.data.deleting_at) throw new HttpError(404,"그림을 찾을 수 없어요.");
  const art=await db.from("daily_artworks").select("id,image_path").eq("user_id",ex.data.user_id).eq("artwork_date",date).eq("status","ready").maybeSingle();
  if(art.error) throw art.error;
  if(!art.data?.image_path?.startsWith(`${ex.data.user_id}/`)) throw new HttpError(404,"그림을 찾을 수 없어요.");
  const item=await db.from("exhibition_items").select("artwork_id").eq("exhibition_id",id).eq("artwork_id",art.data.id).maybeSingle();
  if(item.error) throw item.error;
  if(!item.data) throw new HttpError(404,"그림을 찾을 수 없어요.");
  const downloaded=await db.storage.from("artworks").download(art.data.image_path);
  if(downloaded.error || !downloaded.data) throw new HttpError(404,"그림을 찾을 수 없어요.");
  const contentType=downloaded.data.type==="image/webp"?"image/webp":"image/png";
  return new Response(downloaded.data,{headers:{"Content-Type":contentType,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
});}
