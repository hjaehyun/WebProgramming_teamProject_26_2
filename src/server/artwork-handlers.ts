import "server-only";
import {z} from "zod";
import {authenticated,body,HttpError,json,mutation,rpcError,run} from "./request";
import {dateSchema,frames} from "./core/domain";
import {aiConfigured} from "./core/ai";
import {processOne} from "./core/jobs";
import {getArtwork} from "./data";
export function artworkPost(request:Request) {return run(async()=>{
  mutation(request);const {db,user}=await authenticated();
  const p=z.object({date:dateSchema,redraw:z.boolean().default(false),requestId:z.uuid()}).parse(await body(request));
  if(!aiConfigured()) throw new HttpError(503,"그림 생성 연결 설정이 필요해요.");
  const r=await db.rpc("request_team_artwork",{p_date:p.date,p_redraw:p.redraw,p_request_id:p.requestId});rpcError(r.error);
  await processOne(r.data);
  const artwork=await getArtwork(db,user.id,p.date);
  return json({artwork},artwork.status==="queued"||artwork.status==="processing"?202:200);
});}
/** The frame is the only thing an owner changes on a picture; the RPC limits it to the caller's own day. */
export function artworkFramePut(request:Request,date:string) {return run(async()=>{
  mutation(request);const {db}=await authenticated();
  const day=dateSchema.parse(date);
  const {frame}=z.object({frame:z.enum(frames)}).parse(await body(request));
  const r=await db.rpc("set_artwork_frame",{p_date:day,p_frame:frame});rpcError(r.error);
  if(!r.data) throw new HttpError(404,"그림을 찾을 수 없어요.");
  return json({ok:true,frame:r.data});
});}
export function artworkGet(date:string) {return run(async()=>{
  dateSchema.parse(date);const {db,user}=await authenticated();return json({artwork:await getArtwork(db,user.id,date)});
});}
