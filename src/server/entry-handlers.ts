import "server-only";
import {z} from "zod";
import {authenticated,body,json,mutation,rpcError,run} from "./request";
import {dateSchema,entrySchema} from "./core/domain";
import {entryView} from "./data";
export function entryPost(request:Request) { return run(async()=>{
  mutation(request);const {db}=await authenticated();
  const p=z.object({date:dateSchema,entry:z.object({id:z.uuid(),text:entrySchema.shape.content})}).parse(await body(request));
  // Client timestamps/location are never authoritative and aren't persisted.
  const r=await db.rpc("save_team_entry",{p_id:p.entry.id,p_content:p.entry.text,p_date:p.date});rpcError(r.error);
  return json({entry:entryView(r.data)});
}); }
export function entryChange(request:Request,id:string,remove=false) {return run(async()=>{
  mutation(request);const {db}=await authenticated();z.uuid().parse(id);
  const p=remove?null:z.object({text:entrySchema.shape.content}).parse(await body(request));
  const r=remove?await db.rpc("remove_entry",{p_id:id}):await db.rpc("edit_entry",{p_id:id,p_content:p!.text});
  rpcError(r.error);return json({ok:true});
});}
