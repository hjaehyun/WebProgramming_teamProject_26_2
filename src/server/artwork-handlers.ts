import "server-only";
import {z} from "zod";
import {authenticated,body,HttpError,json,mutation,rpcError,run} from "./request";
import {dateSchema} from "./core/domain";
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
export function artworkGet(date:string) {return run(async()=>{
  dateSchema.parse(date);const {db,user}=await authenticated();return json({artwork:await getArtwork(db,user.id,date)});
});}
export function unavailable(request:Request,kind:"music"|"weather") {return run(async()=>{
  mutation(request);await authenticated();
  throw new HttpError(501,kind==="music"?"노래 추천은 아직 연결 준비 중이에요.":"날씨 조회는 아직 연결 준비 중이에요.");
});}
