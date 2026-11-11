import "server-only";
import {z} from "zod";
import {authenticated,body,HttpError,json,mutation,run} from "./request";
import {dateSchema} from "./core/domain";
import {aiConfigured,curate} from "./core/ai";
export function curationPost(request:Request) {return run(async()=>{
  mutation(request);const {db,user}=await authenticated();
  const p=z.object({dates:z.array(dateSchema).min(3).max(100)}).parse(await body(request));
  if(!aiConfigured()) throw new HttpError(503,"AI 연결 설정이 필요해요.");
  const r=await db.from("daily_artworks").select("artwork_date,scene_summary,tags").eq("user_id",user.id).eq("status","ready").in("artwork_date",p.dates);
  if(r.error) throw r.error;if(!r.data || r.data.length<3) throw new HttpError(400,"완성된 그림 3장 이상이 필요해요.");
  const quota=await db.rpc("reserve_curation");
  if(quota.error) throw new HttpError(quota.error.code==="P0001"?429:503,quota.error.code==="P0001"?quota.error.message:"사용 한도를 확인하지 못했어요.");
  return json(await curate(r.data.map(a=>({date:a.artwork_date,summary:a.scene_summary??"",tags:a.tags??[]}))));
});}
