import "server-only";
import {z} from "zod";
import {authenticated,body,json,mutation,rpcError,run} from "./request";
import {dateSchema,entrySchema,seoulDate} from "./core/domain";
import {adminClient} from "./core/supabase/server";
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
  // The current weather belongs only to today's fragments; a fragment added to a past day gets none.
  const coords=weatherEnabled()&&!row.weather_code&&p.date===seoulDate()?readCoords(input):null;
  if(coords) try {
    const w=await lookupWeather(coords);
    if(w&&!(await db.rpc("set_entry_weather",{p_id:row.id,p_code:w.weather,p_temp:w.tempC})).error) row={...row,weather_code:w.weather,temp_c:w.tempC};
  } catch { /* saved without weather */ }
  return json({entry:entryView(row)});
}); }
export function entryChange(request:Request,id:string,remove=false) {return run(async()=>{
  mutation(request);const {db,user}=await authenticated();z.uuid().parse(id);
  if(remove) {
    // Removing the last fragment of a day with a picture removes the picture too (returned id).
    const r=await db.rpc("remove_team_entry",{p_id:id});rpcError(r.error);
    if(r.data) await removeArtworkFiles(user.id,r.data);
    return json({ok:true,artworkRemoved:Boolean(r.data)});
  }
  const p=z.object({text:entrySchema.shape.content}).parse(await body(request));
  const r=await db.rpc("edit_entry",{p_id:id,p_content:p.text});
  rpcError(r.error);return json({ok:true});
});}
// The picture's row is already gone, so a failure here only leaves unreachable files behind; account
// deletion removes the whole user folder later. It never fails the response.
async function removeArtworkFiles(userId:string,artworkId:string) {
  const folder=`${userId}/${artworkId}`;
  try {
    const bucket=adminClient().storage.from("artworks");
    const listed=await bucket.list(folder,{limit:1000});if(listed.error) throw listed.error;
    const files=(listed.data??[]).filter(item=>item.id).map(item=>`${folder}/${item.name}`);
    if(files.length) {const removed=await bucket.remove(files);if(removed.error) throw removed.error;}
  } catch { console.error("Artwork file cleanup deferred",{id:artworkId}); }
}
