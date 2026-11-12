import "server-only";
import {z} from "zod";
import {authenticated,body,json,mutation,rpcError,run} from "./request";
import {dateSchema,entrySchema} from "./core/domain";
import {entryView} from "./data";
import {lookupWeather,readCoords,weatherEnabled} from "./weather";
export function entryPost(request:Request) { return run(async()=>{
  mutation(request);const {db}=await authenticated();
  const input=await body(request);
  const p=z.object({date:dateSchema,entry:z.object({id:z.uuid(),text:entrySchema.shape.content})}).parse(input);
  // Client timestamps/location are never authoritative and aren't persisted.
  const r=await db.rpc("save_team_entry",{p_id:p.entry.id,p_content:p.entry.text,p_date:p.date});rpcError(r.error);
  let row=r.data;
  // Coordinates are used for this lookup only. A missing or failed lookup never fails the save.
  const coords=weatherEnabled()&&!row.weather_code?readCoords(input):null;
  if(coords) try {
    const w=await lookupWeather(coords);
    if(w&&!(await db.rpc("set_entry_weather",{p_id:row.id,p_code:w.weather,p_temp:w.tempC})).error) row={...row,weather_code:w.weather,temp_c:w.tempC};
  } catch { /* saved without weather */ }
  return json({entry:entryView(row)});
}); }
export function entryChange(request:Request,id:string,remove=false) {return run(async()=>{
  mutation(request);const {db}=await authenticated();z.uuid().parse(id);
  const p=remove?null:z.object({text:entrySchema.shape.content}).parse(await body(request));
  const r=remove?await db.rpc("remove_entry",{p_id:id}):await db.rpc("edit_entry",{p_id:id,p_content:p!.text});
  rpcError(r.error);return json({ok:true});
});}
