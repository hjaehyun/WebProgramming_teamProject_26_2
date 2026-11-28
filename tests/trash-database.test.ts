import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// supabase/migrations/20261128090000_trash.sql on actual PostgreSQL: deleting moves rows into the
// trash tables, restoring brings the original rows back, purging removes them for good.
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const id = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
type Row = Record<string, any>;
let db: PGlite;
let today: string, yesterday: string;

async function asUser(user = alice) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function asWorker() { await db.exec("reset role; set role service_role"); }
async function asOwner() { await db.exec("reset role"); }
async function sql(text: string, params: unknown[] = []) { await asOwner(); const r = await db.query<Row>(text, params); await asUser(); return r.rows; }
const save = (n: number, text = `조각 ${n}`, day = today) => db.query("select public.save_team_entry($1,$2,$3::date)", [id(n), text, day]);
const remove = async (n: number) => (await db.query<{ art: string | null }>("select public.remove_team_entry($1) as art", [id(n)])).rows[0].art;
const restore = async (itemId: string) => (await db.query<{ r: Row }>("select public.restore_trash_item($1) as r", [itemId])).rows[0].r;
const purge = (itemId: string) => db.query("select public.purge_trash_item($1)", [itemId]);
const empty = async (until: string) => (await db.query<{ n: number }>("select public.empty_trash($1::timestamptz) as n", [until])).rows[0].n;
async function request(n: number, redraw = false, day = today) {
  return (await db.query<{ id: string }>("select public.request_team_artwork($1::date,$2,$3) as id", [day, redraw, id(n)])).rows[0].id;
}
async function ready(n: number, day = today) {
  const art = await request(n, false, day);
  await asWorker();
  await db.query("select * from public.claim_artwork($1)", [art]);
  await db.query("update public.daily_artworks set status='ready',title='꽃',scene_summary='꽃을 본 하루',image_prompt='a flower',image_path=user_id::text||'/'||id::text||'/a.png',frame='wood' where id=$1", [art]);
  await asUser();
  return art;
}
const trashed = () => sql("select id,entry_date::text as day,artwork_id,data from public.trashed_entries order by deleted_at,id");
const trashedArt = () => sql("select id,artwork_date::text as day,image_path,data from public.trashed_artworks order by deleted_at,id");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select on storage.objects to anon,authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
    create schema harujogak_private authorization postgres;
    revoke all on schema harujogak_private from public,anon,authenticated,service_role;
    create table harujogak_private.worker_control(singleton boolean primary key,last_request_id bigint);
    insert into harujogak_private.worker_control values(true,999);
    create schema cron; create schema net; create schema vault;
    create table cron.job(jobid bigserial primary key,jobname text,username text,schedule text,command text);
    create table cron.job_run_details(jobid bigint,end_time timestamptz);
    create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,username,schedule,command) values($1,current_user,$2,$3) returning jobid$$;
    create table net.http_request_queue(id bigserial primary key,url text,body jsonb,headers jsonb);
    create table net._http_response(id bigint,status_code integer,timed_out boolean,error_msg text,content text);
    create function net.http_post(url text,body jsonb,params jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into net.http_request_queue(url,body,headers) values($1,$2,$4) returning id$$;
    create table vault.secrets(name text);
    create table vault.decrypted_secrets(name text,decrypted_secret text);
  `);
  for (const file of ["202611040001_initial", "20261111104704_team_frontend_integration", "20261112003000_entry_weather", "20261115090000_artwork_songs",
    "20261120064000_edit_finished_days", "20261125090000_artwork_frames_anime", "20261125111300_past_day_drafts", "20261125121748_daily_connections",
    "20261125144733_art_profile_personalization", "20261128090000_trash"]) {
    await db.exec(await readFile(`supabase/migrations/${file}.sql`, "utf8"));
  }
  const days = (await db.query<Row>("select d::text as today,(d-1)::text as yesterday from (select (now() at time zone 'Asia/Seoul')::date d) s")).rows[0];
  ({ today, yesterday } = days as { today: string; yesterday: string });
}, 30000);

beforeEach(async () => {
  await asOwner();
  await db.exec("truncate auth.users cascade; truncate public.song_pool cascade");
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.exec("update public.profiles set ai_consent_at=now(),onboarded=true");
  await asUser();
});
afterAll(async () => { await db?.close(); });

describe("deleting moves fragments and pictures into the trash", () => {
  test("a fragment keeps its original row in the trash and leaves the journal", async () => {
    await save(1, "산책"); await save(2, "비");
    await sql("update public.entries set weather_code='rain',temp_c=4.5 where id=$1", [id(1)]);
    const [before] = await sql("select * from public.entries where id=$1", [id(1)]);
    expect(await remove(1)).toBeNull();
    expect(await sql("select id from public.entries order by id")).toEqual([{ id: id(2) }]);
    const [item] = await trashed();
    expect(item).toMatchObject({ id: id(1), day: today, artwork_id: null });
    expect(item.data).toMatchObject({ id: id(1), content: "산책", entry_date: today, weather_code: "rain", temp_c: 4.5 });
    expect(new Date(item.data.created_at).toISOString()).toBe(new Date(before.created_at).toISOString());
  });

  test("a fragment saved again with the same id and deleted again keeps only its latest copy in the trash", async () => {
    await save(1, "처음"); await save(2); await remove(1);
    await save(1, "다시 쓴 글"); await remove(1);
    const items = await trashed();
    expect(items.map(r => [r.id, r.data.content])).toEqual([[id(1), "다시 쓴 글"]]);
    // Restoring an old copy while the same fragment is live again would duplicate it.
    await save(1, "또 쓴 글");
    await expect(restore(id(1))).rejects.toThrow(/이미/);
    expect(await sql("select content from public.entries where id=$1", [id(1)])).toEqual([{ content: "또 쓴 글" }]);
  });

  test("the last fragment takes its picture into the trash as one bundle; exhibition and song links go", async () => {
    await save(1);
    const art = await ready(1);
    await sql("insert into public.exhibitions(user_id,title) values($1,'전시')", [alice]);
    await sql("insert into public.exhibition_items(exhibition_id,artwork_id,position) select id,$1,0 from public.exhibitions where user_id=$2", [art, alice]);
    await sql("insert into public.song_pool(mood,video_id,title) values('calm','abcdefghijk','곡')");
    await sql("insert into public.artwork_songs(artwork_id,song_id) select $1,id from public.song_pool", [art]);
    expect(await remove(1)).toBe(art);
    expect(await sql("select id from public.daily_artworks")).toEqual([]);
    expect(await sql("select count(*)::int as n from public.exhibition_items")).toEqual([{ n: 0 }]);
    expect(await sql("select count(*)::int as n from public.artwork_songs")).toEqual([{ n: 0 }]);
    const [pic] = await trashedArt();
    expect(pic).toMatchObject({ id: art, day: today, image_path: `${alice}/${art}/a.png` });
    expect(pic.data).toMatchObject({ id: art, frame: "wood", status: "ready", attempts: 1 });
    expect((await trashed())[0]).toMatchObject({ id: id(1), artwork_id: art });
    expect(await sql("select attempts from public.deleted_artwork_attempts")).toEqual([{ attempts: 1 }]);
  });
});

describe("restoring", () => {
  test("a fragment comes back with the same id, time, date and weather", async () => {
    await save(1); await save(2);
    await sql("update public.entries set weather_code='clear',temp_c=12 where id=$1", [id(1)]);
    const [before] = await sql("select * from public.entries where id=$1", [id(1)]);
    await remove(1);
    expect(await restore(id(1))).toEqual({ restored: "entry", date: today });
    const [after] = await sql("select * from public.entries where id=$1", [id(1)]);
    expect(after).toEqual(before);
    expect(await trashed()).toEqual([]);
  });

  test("a bundle brings back the picture as it was, with its fragment and attempts", async () => {
    await save(1);
    const art = await ready(1);
    const [before] = await sql("select * from public.daily_artworks where id=$1", [art]);
    await remove(1);
    expect(await restore(art)).toEqual({ restored: "artwork", date: today });
    const [after] = await sql("select * from public.daily_artworks where id=$1", [art]);
    expect(after).toEqual(before);
    expect(await sql("select id from public.entries")).toEqual([{ id: id(1) }]);
    expect(await trashed()).toEqual([]); expect(await trashedArt()).toEqual([]);
    expect(await sql("select count(*)::int as n from public.deleted_artwork_attempts")).toEqual([{ n: 0 }]);
  });

  test("when the day already has another picture, only the fragments return and nothing is overwritten", async () => {
    await save(1);
    const old = await ready(1);
    await remove(1);
    await save(2);
    const current = await ready(2);
    expect(await restore(old)).toEqual({ restored: "entry_only", date: today });
    expect(await sql("select id from public.daily_artworks")).toEqual([{ id: current }]);
    expect(await sql("select id from public.entries order by id")).toEqual([{ id: id(1) }, { id: id(2) }]);
    expect((await trashedArt()).map(r => r.id)).toEqual([old]);
    // The picture left alone in the trash cannot replace the current one either.
    await expect(restore(old)).rejects.toThrow(/다른 그림/);
  });

  test("a picture left without fragments needs a day with fragments; a restored fragment brings back the day's latest picture", async () => {
    await save(1);
    const old = await ready(1);
    await remove(1);
    await save(2); const current = await ready(2);
    await restore(old); // fragments only
    // Remove every fragment of the day: the current picture goes to the trash too.
    await remove(1); expect(await remove(2)).toBe(current);
    await expect(restore(old)).rejects.toThrow(/조각/);
    // Restoring a fragment returns the most recent picture of that day, with its own fragment.
    expect(await restore(id(1))).toEqual({ restored: "artwork", date: today });
    expect(await sql("select id from public.daily_artworks")).toEqual([{ id: current }]);
    expect(await sql("select id from public.entries order by id")).toEqual([{ id: id(1) }, { id: id(2) }]);
    await expect(restore(old)).rejects.toThrow(/다른 그림/);
  });

  test("restoring any fragment of a past day whose picture is in the trash brings the picture back; nothing is redrawn", async () => {
    // Written on the day itself, so the automatic close would pick the day up again.
    for (const n of [50, 51]) await sql("insert into public.entries(id,user_id,content,entry_date,created_at) values($1,$2,$3,$4::date,$4::date + interval '3 hours')", [id(n), alice, `지난 조각 ${n}`, yesterday]);
    await asWorker();
    const art = (await db.query<{ id: string }>("select public.close_day_for($1,$2::date) as id", [alice, yesterday])).rows[0].id;
    await db.query("update public.daily_artworks set status='ready',image_path=user_id::text||'/'||id::text||'/a.png' where id=$1", [art]);
    await asUser();
    await remove(51); expect(await remove(50)).toBe(art); // the last one takes the picture along
    expect(await restore(id(51))).toEqual({ restored: "artwork", date: yesterday });
    expect(await sql("select id from public.daily_artworks")).toEqual([{ id: art }]);
    expect(await sql("select id from public.entries order by id")).toEqual([{ id: id(50) }, { id: id(51) }]);
    expect(await trashed()).toEqual([]); expect(await trashedArt()).toEqual([]);
    await asWorker();
    expect((await db.query<{ n: number }>("select public.enqueue_closed_days() as n")).rows[0].n).toBe(0);
    await asUser();
  });

  test("a day whose picture is being drawn, or one already holding 30 fragments, refuses a restore", async () => {
    for (let n = 1; n <= 30; n++) await save(n, `조각 ${n}`, yesterday);
    await remove(30); await save(31, "새 조각", yesterday);
    await expect(restore(id(30))).rejects.toThrow(/30/);
    await save(40); await remove(40); await save(41);
    await request(1);
    await expect(restore(id(40))).rejects.toThrow(/그리는 중/);
  });
});

describe("permanent deletion", () => {
  test("purging a bundle removes the picture and its fragments from the trash", async () => {
    await save(1); await save(2); await remove(2);
    const art = await ready(1);
    await remove(1);
    await purge(art);
    expect(await trashedArt()).toEqual([]);
    expect((await trashed()).map(r => r.id)).toEqual([id(2)]);
    await purge(id(2));
    expect(await trashed()).toEqual([]);
  });

  test("emptying keeps items that arrived after the list was taken", async () => {
    await save(1); await save(2); await save(3);
    await remove(1); await remove(2);
    const [{ cut }] = await sql("select now()::text as cut");
    await sql("update public.trashed_entries set deleted_at=now()-interval '1 minute'");
    await remove(3);
    await sql("update public.trashed_entries set deleted_at=now()+interval '1 minute' where id=$1", [id(3)]);
    expect(await empty(cut)).toBe(2);
    expect((await trashed()).map(r => r.id)).toEqual([id(3)]);
  });
});

describe("only the owner", () => {
  test("others and signed-out callers cannot read, restore or purge; nobody writes the tables directly", async () => {
    await save(1); await save(2); await remove(1);
    await asUser(bob);
    expect((await db.query("select * from public.trashed_entries")).rows).toEqual([]);
    await expect(restore(id(1))).rejects.toThrow(/찾을 수 없어요/);
    await expect(purge(id(1))).rejects.toThrow(/찾을 수 없어요/);
    expect(await empty(new Date(Date.now() + 60000).toISOString())).toBe(0);
    await db.exec("reset role; set role anon");
    await expect(db.query("select * from public.trashed_entries")).rejects.toThrow(/permission/);
    await expect(restore(id(1))).rejects.toThrow();
    await asUser();
    await expect(db.query("delete from public.trashed_entries")).rejects.toThrow(/permission/);
    await expect(db.query("update public.trashed_entries set entry_date=entry_date-1")).rejects.toThrow(/permission/);
    await expect(db.query("insert into public.trashed_artworks(id,user_id,artwork_date,data) values($1,$2,current_date,'{}')", [id(9), alice])).rejects.toThrow(/permission/);
    expect((await trashed()).map(r => r.id)).toEqual([id(1)]);
  });

  test("an account being deleted cannot restore", async () => {
    await save(1); await save(2); await remove(1);
    await sql("update public.profiles set deleting_at=now() where id=$1", [alice]);
    await expect(restore(id(1))).rejects.toThrow(/계정/);
  });
});
