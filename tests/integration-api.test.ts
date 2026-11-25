import {afterEach,beforeEach,describe,expect,test,vi} from "vitest";
const mocks=vi.hoisted(()=>({userClient:vi.fn(),adminClient:vi.fn(),statelessClient:vi.fn(),configured:vi.fn(),processOne:vi.fn(),aiConfigured:vi.fn(),clearRecovery:vi.fn(),requireRecovery:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("../src/server/core/supabase/server",()=>mocks);
vi.mock("../src/server/core/jobs",()=>({processOne:mocks.processOne}));
vi.mock("../src/server/core/ai",()=>({aiConfigured:mocks.aiConfigured}));
vi.mock("../src/server/recovery",()=>({clearRecovery:mocks.clearRecovery,requireRecovery:mocks.requireRecovery}));
import {auth,me,accountDelete,profilePut} from "../src/server/auth-handlers";
import {entryChange,entryPost} from "../src/server/entry-handlers";
import {artworkFramePut,artworkPost} from "../src/server/artwork-handlers";
import {exhibitionGet,exhibitionImageGet} from "../src/server/exhibition-handlers";
import {body,run,json} from "../src/server/request";

const alice="00000000-0000-4000-8000-000000000001",bob="00000000-0000-4000-8000-000000000002";
const exhibitionId="00000000-0000-4000-8000-000000000003",artworkId="00000000-0000-4000-8000-000000000004";
const entryId="00000000-0000-4000-8000-000000000005",requestId="00000000-0000-4000-8000-000000000006";
const date="2026-11-11",origin="http://127.0.0.1:3001";
type Row=Record<string,any>;
function request(path:string,payload:unknown,requestOrigin=origin) {
  return new Request(origin+path,{method:"POST",headers:{Origin:requestOrigin,"Content-Type":"application/json"},body:JSON.stringify(payload)});
}
function fixture() {
  const user={id:alice,email:"alice@example.test",created_at:"2026-11-01T00:00:00Z",identities:[{provider:"email"}]};
  const tables:Record<string,Row[]>={
    profiles:[{id:alice,nickname:"앨리스",art_style:"watercolor",onboarded:true,ai_consent_at:"2026-11-01",deleting_at:null},{id:bob,nickname:"밥",onboarded:true,deleting_at:null}],
    entries:[{id:entryId,user_id:alice,entry_date:date,content:"내 기록",created_at:"2026-11-11T00:00:00Z"},{id:"other-entry",user_id:bob,entry_date:date,content:"비공개 다른 사용자 기록"}],
    daily_artworks:[{id:artworkId,user_id:alice,artwork_date:date,status:"ready",art_style:"watercolor",scene:"park",tags:["산책"],scene_summary:"산책한 하루",image_path:`${alice}/${artworkId}/token.png`,attempts:1,last_request_id:requestId},{id:"other-artwork",user_id:bob,artwork_date:date,status:"ready",image_path:`${bob}/private.png`}],
    exhibitions:[{id:exhibitionId,user_id:alice,title:"내 전시",description:"소개",is_public:true}],
    exhibition_items:[{exhibition_id:exhibitionId,artwork_id:artworkId,position:0,caption:"공원"}],
  };
  const queries:Array<{table:string;filters:Array<[string,unknown]>}>=[];
  class Query {
    filters:Array<[string,unknown]>=[]; start=0;end=Infinity;changes?:Row; membership?:[string,unknown[]];
    constructor(public table:string) {queries.push(this);}
    select(_fields:string) {return this;}
    eq(key:string,value:unknown) {this.filters.push([key,value]);return this;}
    in(key:string,values:unknown[]) {this.membership=[key,values];return this;}
    order(_key:string,_options?:unknown) {return this;}
    range(start:number,end:number) {this.start=start;this.end=end;return this;}
    limit(count:number) {this.end=count-1;return this;}
    update(changes:Row) {this.changes=changes;return this;}
    result() {
      const selected=(tables[this.table]??[]).filter(r=>this.filters.every(([k,v])=>r[k]===v)&&(!this.membership||this.membership[1].includes(r[this.membership[0]]))).slice(this.start,this.end+1);
      if(this.changes) selected.forEach(r=>Object.assign(r,this.changes));
      return {data:selected,error:null};
    }
    async single() {return {data:this.result().data[0]??null,error:null};}
    async maybeSingle() {return this.single();}
    then(resolve:any,reject:any) {return Promise.resolve(this.result()).then(resolve,reject);}
  }
  const bucket={
    createSignedUrls:vi.fn(async(paths:string[])=>({data:paths.map(path=>({path,signedUrl:`https://storage.invalid/${path}?token=private-token`})),error:null})),
    list:vi.fn(async()=>({data:[{id:"file-id",name:"image.png"}],error:null})),
    remove:vi.fn(async(_paths:string[])=>({data:[],error:null as unknown})),
    download:vi.fn(async(_path:string)=>({data:new Blob([new Uint8Array([137,80,78,71])],{type:"image/png"}),error:null})),
  };
  const db={
    auth:{getUser:vi.fn(async()=>({data:{user:user as typeof user|null},error:null})),signInWithPassword:vi.fn(async()=>({error:null})),signUp:vi.fn(async()=>({data:{session:null},error:null})),signOut:vi.fn(async()=>({error:null})),admin:{deleteUser:vi.fn(async()=>({error:null}))}},
    from:(table:string)=>new Query(table),
    rpc:vi.fn(async(name:string,args?:Row)=>{
      if(name==="begin_account_deletion") tables.profiles[0].deleting_at="2026-11-11T00:00:00Z";
      if(name==="save_team_entry") return {data:{id:args!.p_id,content:args!.p_content,created_at:"2026-11-11T01:00:00Z"},error:null};
      if(name==="set_artwork_frame") return {data:args!.p_frame,error:null};
      return {data:artworkId,error:null};
    }),
    storage:{from:()=>bucket},
  };
  return {db,bucket,tables,queries,user};
}
let f:ReturnType<typeof fixture>;
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv("APP_URL",origin);vi.stubGlobal("fetch",vi.fn(()=>{throw new Error("Unexpected external request");}));
  f=fixture();mocks.configured.mockReturnValue(true);mocks.aiConfigured.mockReturnValue(true);
  mocks.userClient.mockResolvedValue(f.db);mocks.adminClient.mockReturnValue(f.db);mocks.statelessClient.mockReturnValue(f.db);
  mocks.processOne.mockResolvedValue({processed:true,status:"ready"});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe("authenticated API boundaries",()=>{
  test("private dashboard identifies the authenticated owner for session-only draft isolation",async()=>{
    const response=await me();
    expect(response.status).toBe(200);
    expect((await response.json()).account.id).toBe(alice);
  });
  test("rejects cross-origin writes before authentication or job creation",async()=>{
    const r=await artworkPost(request("/api/artworks",{date,requestId},"https://another.invalid"));
    expect(r.status).toBe(403);expect(mocks.userClient).not.toHaveBeenCalled();expect(mocks.processOne).not.toHaveBeenCalled();
  });
  test("rejects signed-out writes",async()=>{
    f.db.auth.getUser.mockResolvedValue({data:{user:null},error:null});
    expect((await entryPost(request("/api/me/entries",{date,entry:{id:entryId,text:"글"}}))).status).toBe(401);
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  test("null credentials are a validation error, not a server error",async()=>{
    expect((await auth(request("/api/auth/login",null),"login")).status).toBe(400);
  });
  test("limits the streamed request body before parsing it",async()=>{
    const r=await run(async()=>json(await body(request("/api/auth/login",{value:"x".repeat(20001)}))));
    expect(r.status).toBe(413);
  });
  test("entry creation ignores supplied ownership/time/location and returns server time",async()=>{
    const r=await entryPost(request("/api/me/entries",{date,user_id:bob,lat:37.5,lon:127,entry:{id:entryId,text:"  산책  ",at:"1900-01-01",user_id:bob}}));
    expect(r.status).toBe(200);
    expect(f.db.rpc).toHaveBeenCalledWith("save_team_entry",{p_id:entryId,p_content:"산책",p_date:date});
    expect(await r.json()).toEqual({entry:{id:entryId,text:"산책",at:"2026-11-11T01:00:00Z",weather:null}});
  });
  test.each(["2026-02-30","2026-11-9","not-a-date",null])("invalid entry and generation dates %s are rejected before RPC or AI work",async invalidDate=>{
    expect((await entryPost(request("/api/me/entries",{date:invalidDate,entry:{id:entryId,text:"지난 기록"}}))).status).toBe(400);
    expect((await artworkPost(request("/api/artworks",{date:invalidDate,requestId}))).status).toBe(400);
    expect(f.db.rpc).not.toHaveBeenCalled();expect(mocks.processOne).not.toHaveBeenCalled();
  });
  test.each(["entry","artwork"])("the database's future-date refusal reaches the %s caller without starting AI work",async kind=>{
    const tomorrow=new Date(Date.now()+33*60*60*1000).toISOString().slice(0,10);
    const message="오늘이나 지난 날만 사용할 수 있어요.";
    // This checks the HTTP mapping; actual future-date enforcement is exercised by the PGlite tests.
    f.db.rpc.mockResolvedValueOnce({data:null,error:{code:"P0001",message}} as never);
    const response=kind==="entry"
      ? await entryPost(request("/api/me/entries",{date:tomorrow,entry:{id:entryId,text:"미래 기록"}}))
      : await artworkPost(request("/api/artworks",{date:tomorrow,requestId}));
    expect(response.status).toBe(409);expect(await response.json()).toEqual({error:message});
    expect(f.db.rpc).toHaveBeenCalledWith(kind==="entry"?"save_team_entry":"request_team_artwork",expect.objectContaining({p_date:tomorrow}));
    expect(mocks.processOne).not.toHaveBeenCalled();
  });
  test("profile requires explicit AI consent and maps frontend style",async()=>{
    const input={nick:"나",style:"crayon"};
    expect((await profilePut(request("/api/me/profile",input))).status).toBe(400);
    const r=await profilePut(request("/api/me/profile",{...input,consent:false}));
    expect(r.status).toBe(200);expect(f.tables.profiles[0].art_style).toBe("crayon");expect(f.tables.profiles[0].ai_consent_at).toBeNull();
  });
  test("optional appearance fields round-trip only through the owner's private profile",async()=>{
    const artProfile={gender:"neutral",ageRange:"20s",occupation:"  개발자  ",appearance:"  둥근 안경  "};
    const r=await profilePut(request("/api/me/profile",{nick:"나",style:"water",consent:true,artProfile,artProfileEnabled:true,user_id:bob}));
    expect(r.status).toBe(200);
    expect(f.tables.profiles[0]).toMatchObject({art_profile:{...artProfile,occupation:"개발자",appearance:"둥근 안경"},art_profile_enabled:true});
    expect(f.tables.profiles[1]).not.toHaveProperty("art_profile");
    const payload=await (await me()).json();
    expect(payload.profile).toMatchObject({artProfile:{...artProfile,occupation:"개발자",appearance:"둥근 안경"},artProfileEnabled:true});
    expect(payload.artworks[date]).not.toHaveProperty("profile_snapshot");
  });
  test("older clients editing the basic profile preserve saved appearance preferences",async()=>{
    const saved={gender:"male",occupation:"도서관 사서"};
    Object.assign(f.tables.profiles[0],{art_profile:saved,art_profile_enabled:true});
    expect((await profilePut(request("/api/me/profile",{nick:"새 이름",style:"pencil",consent:true}))).status).toBe(200);
    expect(f.tables.profiles[0]).toMatchObject({nickname:"새 이름",art_profile:saved,art_profile_enabled:true});
  });
  test("withdrawing AI consent disables appearance use while retaining editable preferences",async()=>{
    Object.assign(f.tables.profiles[0],{art_profile:{appearance:"안경"},art_profile_enabled:true});
    expect((await profilePut(request("/api/me/profile",{nick:"나",style:"water",consent:false,artProfileEnabled:true}))).status).toBe(200);
    expect(f.tables.profiles[0]).toMatchObject({ai_consent_at:null,art_profile_enabled:false,art_profile:{appearance:"안경"}});
    expect((await (await me()).json()).profile.artProfileEnabled).toBe(false);
  });
  test("old profiles receive empty optional fields without enabling personalization",async()=>{
    const payload=await (await me()).json();
    expect(payload.profile).toMatchObject({artProfile:{gender:"unspecified",ageRange:"unspecified",occupation:"",appearance:""},artProfileEnabled:false});
  });
  test.each([null,[],{gender:"invented"},{ageRange:"exact-age"},{occupation:"a".repeat(81)},{appearance:"a".repeat(201)},
    {occupation:"line\nbreak"},{appearance:"hidden\u0000text"},{email:"private@example.test"}])("invalid art profile %j is rejected without changing the profile",async artProfile=>{
    const before=JSON.stringify(f.tables.profiles);
    const r=await profilePut(request("/api/me/profile",{nick:"나",style:"water",consent:true,artProfile,artProfileEnabled:true}));
    expect(r.status).toBe(400);expect(JSON.stringify(f.tables.profiles)).toBe(before);
  });
  test("appearance use can be disabled independently and fields can be explicitly cleared",async()=>{
    Object.assign(f.tables.profiles[0],{art_profile:{occupation:"개발자"},art_profile_enabled:true});
    expect((await profilePut(request("/api/me/profile",{nick:"나",style:"water",consent:true,artProfile:{},artProfileEnabled:false}))).status).toBe(200);
    expect(f.tables.profiles[0]).toMatchObject({art_profile_enabled:false,art_profile:{gender:"unspecified",ageRange:"unspecified",occupation:"",appearance:""}});
  });
  test("generation uses only the server job and owner-filtered saved records",async()=>{
    const r=await artworkPost(request("/api/artworks",{date,requestId,id:"other-artwork",imagePath:`${bob}/private.png`,entries:["injected"]}));
    const result=await r.json();expect(r.status).toBe(200);expect(mocks.processOne).toHaveBeenCalledWith(artworkId);
    expect(result.artwork.requestId).toBe(requestId);expect(result.artwork.entries).toHaveLength(1);
    expect(result.artwork.entries[0].text).toBe("내 기록");expect(result.artwork).not.toHaveProperty("image_path");
    expect(f.db.rpc).toHaveBeenCalledWith("request_team_artwork",{p_date:date,p_redraw:false,p_request_id:requestId});
  });
  test("pending/failed jobs stay pending/failed in the response",async()=>{
    f.tables.daily_artworks[0].status="processing";
    const pending=await artworkPost(request("/api/artworks",{date,requestId}));expect(pending.status).toBe(202);expect((await pending.json()).artwork.status).toBe("processing");
    f.tables.daily_artworks[0].status="failed";
    const failed=await artworkPost(request("/api/artworks",{date,requestId}));expect((await failed.json()).artwork.status).toBe("failed");
  });
  test("a missing signed image URL cannot masquerade as a completed generation",async()=>{
    f.bucket.createSignedUrls.mockResolvedValue({data:[],error:null});
    const r=await artworkPost(request("/api/artworks",{date,requestId}));
    expect(r.status).toBe(503);expect(await r.json()).toHaveProperty("error");
    const dashboard=await me();
    expect((await dashboard.json()).artworks[date].imageError).toBe(true);
  });
  test("redraw phase depends on its new prompt rather than its retained old summary",async()=>{
    const art=f.tables.daily_artworks[0];art.status="processing";art.image_prompt=null;
    const response=await artworkPost(request("/api/artworks",{date,requestId}));
    const data=await response.json();expect(data.artwork.phase).toBe("summarizing");expect(data.artwork).not.toHaveProperty("image_prompt");
  });
  test("artworks beyond the first page do not turn closed entries into drafts",async()=>{
    const base=f.tables.daily_artworks[0];
    f.tables.daily_artworks=Array.from({length:1001},(_,i)=>({...base,id:`art-${i}`,artwork_date:`saved-day-${i}`,image_path:null}));
    f.tables.entries=[{id:entryId,user_id:alice,entry_date:"saved-day-1000",content:"오래된 마감 기록",created_at:"2023-01-01T00:00:00Z"}];
    f.tables.exhibitions=[];
    const response=await me();const data=await response.json();
    expect(Object.keys(data.artworks)).toHaveLength(1001);expect(data.artworks["saved-day-1000"].entries).toHaveLength(1);expect(data.drafts).toEqual({});
  });
  test("past drafts stay on their selected date even when written today, and only owner-filtered records are returned",async()=>{
    const pastDay="2026-11-09",otherPastDay="2026-11-10";
    const writtenNow=new Date().toISOString();
    const today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
    f.tables.entries.push(
      {id:"past-original",user_id:alice,entry_date:pastDay,content:"그날 남긴 기록",created_at:"2026-11-09T00:00:00Z"},
      {id:"past-added-today",user_id:alice,entry_date:pastDay,content:"오늘 떠올린 지난 기록",created_at:writtenNow},
      {id:"another-past",user_id:alice,entry_date:otherPastDay,content:"다른 지난 날",created_at:writtenNow},
      {id:"today-draft",user_id:alice,entry_date:today,content:"오늘 기록",created_at:writtenNow},
      {id:"foreign-past",user_id:bob,entry_date:pastDay,content:"타인의 지난 기록",created_at:writtenNow},
    );
    const response=await me();expect(response.status).toBe(200);
    const data=await response.json();
    expect(Object.keys(data.drafts).sort()).toEqual([pastDay,otherPastDay,today].sort());
    expect(data.drafts[pastDay]).toEqual([
      {id:"past-original",text:"그날 남긴 기록",at:"2026-11-09T00:00:00Z",weather:null},
      {id:"past-added-today",text:"오늘 떠올린 지난 기록",at:writtenNow,weather:null},
    ]);
    expect(data.drafts[today].map((entry:Row)=>entry.id)).toEqual(["today-draft"]);
    expect(data.drafts[date]).toBeUndefined();expect(data.artworks[date].entries.map((entry:Row)=>entry.id)).toEqual([entryId]);
    expect(JSON.stringify(data)).not.toContain("타인의 지난 기록");
    // The fixture emulates explicit filters, not RLS. Database ownership tests cover the latter.
    for(const query of f.queries.filter(q=>["entries","daily_artworks"].includes(q.table))) expect(query.filters).toContainEqual(["user_id",alice]);
    for(const [paths] of f.bucket.createSignedUrls.mock.calls) expect(paths.every(path=>path.startsWith(`${alice}/`))).toBe(true);
  });
  test("a past day's first generation moves its drafts into that artwork while leaving other dates alone",async()=>{
    const pastDay="2026-11-09",untouchedDay="2026-11-10";
    const pastArtId="00000000-0000-4000-8000-000000000090";
    f.tables.entries.push(
      {id:"past-a",user_id:alice,entry_date:pastDay,content:"지나간 산책",created_at:"2026-11-25T01:00:00Z"},
      {id:"past-b",user_id:alice,entry_date:pastDay,content:"떠오른 풍경",created_at:"2026-11-25T02:00:00Z"},
      {id:"untouched",user_id:alice,entry_date:untouchedDay,content:"다른 날의 기록",created_at:"2026-11-25T03:00:00Z"},
      {id:"foreign-past",user_id:bob,entry_date:pastDay,content:"다른 사람 기록",created_at:"2026-11-25T01:00:00Z"},
    );
    const before=await (await me()).json();
    expect(before.drafts[pastDay]).toHaveLength(2);expect(before.artworks[pastDay]).toBeUndefined();
    // Model the committed RPC and worker result; the SQL tests verify creation and attempt accounting.
    const newArtwork={...f.tables.daily_artworks[0],id:pastArtId,artwork_date:pastDay,status:"queued",image_path:null,attempts:0};
    f.db.rpc.mockImplementationOnce(async()=>{f.tables.daily_artworks.push(newArtwork);return {data:pastArtId,error:null};});
    mocks.processOne.mockImplementationOnce(async()=>{
      Object.assign(newArtwork,{status:"ready",attempts:1,image_path:`${alice}/${pastArtId}/first.png`});
      return {processed:true,status:"ready"};
    });
    const generated=await artworkPost(request("/api/artworks",{date:pastDay,redraw:false,requestId}));
    expect(generated.status).toBe(200);
    expect(f.db.rpc).toHaveBeenCalledWith("request_team_artwork",{p_date:pastDay,p_redraw:false,p_request_id:requestId});
    expect(mocks.processOne).toHaveBeenCalledWith(pastArtId);
    const artwork=(await generated.json()).artwork;
    expect(artwork.date).toBe(pastDay);expect(artwork.entries.map((entry:Row)=>entry.id)).toEqual(["past-a","past-b"]);
    const after=await (await me()).json();
    expect(after.drafts[pastDay]).toBeUndefined();expect(after.artworks[pastDay].entries).toEqual(before.drafts[pastDay]);
    expect(after.drafts[untouchedDay]).toEqual(before.drafts[untouchedDay]);
    expect(after.artworks[date]).toEqual(before.artworks[date]);
  });
  test("a picture reports whether its fragments changed since drawing, without exposing the snapshot",async()=>{
    f.tables.daily_artworks[0].entry_snapshot=[{content:"내 기록",created_at:"2026-11-11T00:00:00+00:00"}];
    let data=await (await me()).json();
    expect(data.artworks[date].entriesChanged).toBe(false);expect(JSON.stringify(data)).not.toContain("entry_snapshot");
    f.tables.daily_artworks[0].entry_snapshot=[{content:"예전 기록"}];
    data=await (await me()).json();expect(data.artworks[date].entriesChanged).toBe(true);
  });
  test("removing a day's last fragment also deletes that picture's files",async()=>{
    const remove=()=>entryChange(new Request(origin+`/api/me/entries/${entryId}`,{method:"DELETE",headers:{Origin:origin}}),entryId,true);
    const r=await remove();
    expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,artworkRemoved:true});
    expect(f.db.rpc).toHaveBeenCalledWith("remove_team_entry",{p_id:entryId});
    expect(f.bucket.list).toHaveBeenCalledWith(`${alice}/${artworkId}`,{limit:1000});
    expect(f.bucket.remove).toHaveBeenCalledWith([`${alice}/${artworkId}/image.png`]);
    // Another fragment remains: the picture and its files stay.
    vi.clearAllMocks();f.db.rpc.mockResolvedValueOnce({data:null,error:null} as never);
    expect(await (await remove()).json()).toEqual({ok:true,artworkRemoved:false});expect(f.bucket.list).not.toHaveBeenCalled();
    // The picture row is already gone, so a storage failure must not turn the removal into an error.
    const logged=vi.spyOn(console,"error").mockImplementation(()=>{});
    f.bucket.remove.mockResolvedValue({data:[],error:new Error("Storage temporarily unavailable")});
    const failed=await remove();expect(failed.status).toBe(200);expect(await failed.json()).toEqual({ok:true,artworkRemoved:true});
    expect(logged).toHaveBeenCalledWith("Artwork file cleanup deferred",{id:artworkId});logged.mockRestore();
  });
  test("file cleanup failure keeps the account and exposes a retryable deletion state",async()=>{
    f.bucket.remove.mockResolvedValue({data:[],error:new Error("Storage temporarily unavailable")});
    const r=await accountDelete(request("/api/me",{password:"safe-test-password"}));
    expect(r.status).toBe(503);expect(f.db.auth.admin.deleteUser).not.toHaveBeenCalled();
    const reload=await me();expect(reload.status).toBe(200);const data=await reload.json();
    expect(data.deletionPending).toBe(true);expect(data.account.email).toBe("alice@example.test");expect(data.artworks).toEqual({});
    expect((await profilePut(request("/api/me/profile",{nick:"x",style:"water",consent:true}))).status).toBe(409);
  });
});

describe("public exhibition projection",()=>{
  test("does not serialize private notes, user identifiers, storage paths or signed tokens",async()=>{
    f.tables.profiles[0].art_profile={appearance:"private appearance marker",occupation:"private occupation marker"};
    f.tables.daily_artworks[0].profile_snapshot=f.tables.profiles[0].art_profile;
    const r=await exhibitionGet(exhibitionId);expect(r.status).toBe(200);const result=await r.json();const serialized=JSON.stringify(result);
    expect(result.items).toHaveLength(1);expect(result.items[0].imageUrl).toBe(`/api/exhibitions/${exhibitionId}/images/${date}`);
    for(const value of [alice,bob,"내 기록","private-token","image_path","user_id","alice@example.test","private appearance marker","private occupation marker","profile_snapshot","art_profile"]) expect(serialized).not.toContain(value);
    expect(f.bucket.createSignedUrls).not.toHaveBeenCalled();
  });
  test("private exhibitions deny signed-out viewers before reading artworks",async()=>{
    f.tables.exhibitions[0].is_public=false;f.db.auth.getUser.mockResolvedValue({data:{user:null},error:null});
    expect((await exhibitionGet(exhibitionId)).status).toBe(404);
    expect(f.queries.some(q=>q.table==="daily_artworks")).toBe(false);
  });
  test("image access closes when a public exhibition becomes private",async()=>{
    f.db.auth.getUser.mockResolvedValue({data:{user:null},error:null});
    const image=await exhibitionImageGet(exhibitionId,date);expect(image.status).toBe(200);expect(image.headers.get("Cache-Control")).toContain("no-store");
    f.tables.exhibitions[0].is_public=false;
    expect((await exhibitionImageGet(exhibitionId,date)).status).toBe(404);expect(f.bucket.download).toHaveBeenCalledTimes(1);
  });
  test("a public image must be both owned by the exhibitor and selected in the exhibition",async()=>{
    f.tables.exhibition_items=[];
    expect((await exhibitionImageGet(exhibitionId,date)).status).toBe(404);expect(f.bucket.download).not.toHaveBeenCalled();
  });
  test("public items expose exactly the agreed keys, with the frame",async()=>{
    f.tables.daily_artworks[0].frame="diary";
    const items=(await (await exhibitionGet(exhibitionId)).json()).items;
    expect(Object.keys(items[0]).sort()).toEqual(["date","frame","imageUrl","note","scene","song","summary"]);
    expect(items[0].frame).toBe("diary");
  });
  test("a public item without a stored frame shows the basic frame",async()=>{
    const items=(await (await exhibitionGet(exhibitionId)).json()).items;
    expect(items[0].frame).toBe("basic");
  });
});

describe("artwork frames",()=>{
  const put=(payload:unknown,day=date,requestOrigin=origin)=>artworkFramePut(new Request(`${origin}/api/me/artworks/${day}/frame`,{method:"PUT",headers:{Origin:requestOrigin,"Content-Type":"application/json"},body:JSON.stringify(payload)}),day);
  test("a frame change goes through the owner RPC only",async()=>{
    const r=await put({frame:"wood",user_id:bob});
    expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true,frame:"wood"});
    expect(f.db.rpc).toHaveBeenCalledWith("set_artwork_frame",{p_date:date,p_frame:"wood"});
  });
  test("unknown frames and impossible dates are rejected before the RPC",async()=>{
    expect((await put({frame:"gold"})).status).toBe(400);
    expect((await put({frame:"wood"},"2026-13-01")).status).toBe(400);
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  test("cross-origin and signed-out frame changes are refused",async()=>{
    expect((await put({frame:"wood"},date,"https://another.invalid")).status).toBe(403);
    f.db.auth.getUser.mockResolvedValue({data:{user:null},error:null});
    expect((await put({frame:"wood"})).status).toBe(401);
    expect(f.db.rpc).not.toHaveBeenCalled();
  });
  test("a day without the caller's picture is 404",async()=>{
    f.db.rpc.mockResolvedValueOnce({data:null,error:null});
    expect((await put({frame:"tape"})).status).toBe(404);
  });
  test("the caller's own artwork carries its frame, basic when unset",async()=>{
    const first=await artworkPost(request("/api/artworks",{date,requestId}));
    expect((await first.json()).artwork.frame).toBe("basic");
    f.tables.daily_artworks[0].frame="polaroid";
    const second=await artworkPost(request("/api/artworks",{date,requestId}));
    expect((await second.json()).artwork.frame).toBe("polaroid");
  });
});

describe("anime drawing style",()=>{
  test("profile accepts the anime style as is",async()=>{
    const r=await profilePut(request("/api/me/profile",{nick:"나",style:"anime",consent:true}));
    expect(r.status).toBe(200);expect(f.tables.profiles[0].art_style).toBe("anime");
  });
});
