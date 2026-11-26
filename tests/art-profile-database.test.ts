import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// Actual SQL and role checks in PostgreSQL. A single PGlite connection cannot prove
// multi-session lock contention; both profile-edit/request orders are checked here.
const migration = "supabase/migrations/20261125144733_art_profile_personalization.sql";
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const id = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
const details = { gender: "female", ageRange: "30s", occupation: "개발자", appearance: "짧은 머리와 둥근 안경" };
type Job = { id: string; profile_snapshot: Record<string, string>; status: string; attempts: number; image_prompt: string | null; entry_snapshot: unknown[]; claim_token: string | null };
let db: PGlite, today: string, yesterday: string;
let legacyBefore: unknown, legacyAfter: unknown;
const owner = () => db.exec("reset role");
async function user(who = alice) { await owner(); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec("set role authenticated"); }
const worker = () => db.exec("reset role; set role service_role");
const profile = (value: unknown = details, enabled = true) => db.query("update public.profiles set art_profile=$1::jsonb,art_profile_enabled=$2 where id=$3", [JSON.stringify(value), enabled, alice]);
const save = (n = 1, day = today) => db.query("select public.save_team_entry($1,'공원에서 잠시 쉬었다',$2::date)", [id(n), day]);
const request = async (n = 20, redraw = false, day = today) => (await db.query<{ id: string }>("select public.request_team_artwork($1::date,$2,$3) as id", [day, redraw, id(n)])).rows[0].id;
async function row(art: string) { return (await db.query<Job>("select * from public.daily_artworks where id=$1", [art])).rows[0]; }
async function claim(art: string) { await worker(); const value = (await db.query<Job>("select * from public.claim_artwork($1)", [art])).rows[0]; await user(); return value; }
async function finish(art: string, status = "ready") { await worker(); await db.query("update public.daily_artworks set status=$2,title='공원',scene_summary='공원에서 쉬었다',image_prompt='Existing saved prompt' where id=$1", [art,status]); await user(); }
async function picture(status = "ready") { await save(); const art = await request(); await claim(art); await finish(art,status); return art; }

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
  `);
  for (const name of ["202611040001_initial", "20261111104704_team_frontend_integration", "20261115090000_artwork_songs", "20261120064000_edit_finished_days", "20261125111300_past_day_drafts"]) {
    await db.exec(await readFile(`supabase/migrations/${name}.sql`, "utf8"));
  }
  const days = (await db.query<{ today: string; yesterday: string }>("select d::text as today,(d-1)::text as yesterday from (select (now() at time zone 'Asia/Seoul')::date d) s")).rows[0];
  ({ today, yesterday } = days);
  await db.query("insert into auth.users values($1)", [alice]);
  await db.query("insert into public.daily_artworks(user_id,artwork_date,art_style,entry_snapshot,status,attempts,image_prompt) values($1,$2,'watercolor','[]','ready',2,'Legacy prompt')", [alice,yesterday]);
  legacyBefore = (await db.query("select to_jsonb(a) as art from public.daily_artworks a")).rows;
  await db.exec(await readFile(migration, "utf8"));
  legacyAfter = (await db.query("select to_jsonb(a)-'profile_snapshot' as art from public.daily_artworks a")).rows;
}, 30000);
beforeEach(async () => {
  await owner(); await db.exec("truncate auth.users cascade");
  await db.query("insert into auth.users values($1),($2)", [alice,bob]);
  await db.exec("update public.profiles set ai_consent_at=now(),onboarded=true");
  await user();
});
afterAll(async () => { await db?.close(); });

describe("optional art profile schema and permissions", () => {
  test("migration preserves every pre-existing artwork field", () => { expect(legacyAfter).toEqual(legacyBefore); });
  test("existing accounts stay opted out and old profile updates still work", async () => {
    expect((await db.query("select art_profile,art_profile_enabled from public.profiles")).rows).toEqual([{ art_profile: {}, art_profile_enabled: false }]);
    await db.query("update public.profiles set nickname='이름',art_style='pencil',ai_consent_at=now() where id=$1", [alice]);
    expect((await db.query("select art_profile,art_profile_enabled from public.profiles")).rows[0]).toEqual({ art_profile: {}, art_profile_enabled: false });
  });
  test.each([
    null, [], "plain", { unexpected: "value" }, { gender: "other-value" }, { gender: null }, { gender: 1 },
    { ageRange: "15" }, { ageRange: null }, { occupation: 7 }, { occupation: "a".repeat(81) },
    { appearance: "a".repeat(201) }, { appearance: ["blue"] }, { occupation: "line\nbreak" },
    { appearance: "tab\there" }, { appearance: "control\u0001here" }, { occupation: "delete\u007fhere" },
  ])("rejects invalid profile %j at the database boundary", async value => {
    await expect(profile(value)).rejects.toThrow();
    expect((await db.query("select art_profile from public.profiles")).rows[0]).toEqual({ art_profile: {} });
  });
  test("accepts optional fields and their exact allowed limits", async () => {
    for (const value of [{}, { gender: "neutral" }, { ageRange: "60plus" }, { occupation: "a".repeat(80), appearance: "가".repeat(200) }]) {
      await profile(value); expect((await db.query("select art_profile from public.profiles")).rows[0]).toEqual({ art_profile: value });
    }
  });
  test("a SQL NULL profile is also rejected", async () => { await expect(db.exec("update public.profiles set art_profile=null")).rejects.toThrow(); });
  test("other accounts cannot read or change details or their saved generation snapshot", async () => {
    await profile(); await save(); const art = await request();
    await user(bob);
    expect((await db.query("select art_profile from public.profiles where id=$1", [alice])).rows).toEqual([]);
    expect((await db.query("update public.profiles set art_profile='{}' where id=$1 returning id", [alice])).rows).toEqual([]);
    expect((await db.query("select profile_snapshot from public.daily_artworks where id=$1", [art])).rows).toEqual([]);
    await user(); expect((await row(art)).profile_snapshot).toEqual(details);
  });
  test("browser roles cannot write artwork snapshots or call privileged closure helpers", async () => {
    await save(); const art = await request();
    await expect(db.query("update public.daily_artworks set profile_snapshot=$1 where id=$2", [JSON.stringify(details),art])).rejects.toThrow(/permission/i);
    await expect(db.query("select public.close_day_for($1,$2)", [bob,today])).rejects.toThrow(/permission/i);
    await expect(db.exec("select public.disable_art_profile_without_consent()")).rejects.toThrow(/permission/i);
    await db.exec("reset role; set role anon");
    await expect(db.exec("select art_profile from public.profiles")).rejects.toThrow(/permission/i);
    await expect(db.exec("select profile_snapshot from public.daily_artworks")).rejects.toThrow(/permission/i);
  });
  test("withdrawing consent disables personalization without blocking the old client", async () => {
    await profile();
    await db.query("update public.profiles set ai_consent_at=null where id=$1", [alice]);
    expect((await db.query("select ai_consent_at,art_profile_enabled,art_profile from public.profiles")).rows[0]).toEqual({ ai_consent_at: null, art_profile_enabled: false, art_profile: details });
    await profile(details,true);
    expect((await db.query("select art_profile_enabled from public.profiles")).rows[0]).toEqual({ art_profile_enabled: false });
    await db.query("update public.profiles set ai_consent_at=now() where id=$1", [alice]);
    expect((await db.query("select art_profile_enabled from public.profiles")).rows[0]).toEqual({ art_profile_enabled: false });
  });
});

describe("generation-time profile snapshots", () => {
  test("default-off and explicitly disabled profiles produce no generation context", async () => {
    await profile(details,false); await save(); const art = await request();
    expect((await row(art)).profile_snapshot).toEqual({});
  });
  test("enabled creation snapshots only meaningful selected details", async () => {
    await profile({ gender: "unspecified", ageRange: "unspecified", occupation: "  개발자  ", appearance: "   " });
    await save(); const art = await request();
    expect((await row(art)).profile_snapshot).toEqual({ occupation: "개발자" });
  });
  test("automatic closure captures the same opted-in profile and remains idempotent", async () => {
    await profile(); await owner();
    await db.query("insert into public.entries(id,user_id,content,entry_date,created_at) values($1,$2,'이전 기록',$3::date,($3::date+interval '12 hours') at time zone 'Asia/Seoul')", [id(1),alice,yesterday]);
    await worker();
    expect((await db.query<{ n: number }>("select public.enqueue_closed_days() as n")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select public.enqueue_closed_days() as n")).rows[0].n).toBe(0);
    await user();
    expect((await db.query<Job>("select * from public.daily_artworks")).rows).toMatchObject([{ profile_snapshot: details, attempts: 0, status: "queued" }]);
  });
  test("an account without AI consent cannot make a profile-bearing request", async () => {
    await profile(); await save(); await db.exec("update public.profiles set ai_consent_at=null");
    await expect(request()).rejects.toThrow(/동의/);
    expect((await db.query("select * from public.daily_artworks")).rows).toEqual([]);
  });
  test.each(["queued", "processing"])("editing a profile does not mutate an already requested %s job", async status => {
    await profile(); await save(); const art = await request();
    if (status === "processing") await claim(art);
    const before = await row(art);
    await profile({ ...details, appearance: "긴 머리" }); await request(21,true);
    expect(await row(art)).toEqual(before);
  });
  test("a ready result and its request ID are preserved until an explicit new redraw", async () => {
    await profile(); const art = await picture(); const before = await row(art);
    const changed = { ...details, occupation: "학생" }; await profile(changed);
    await request(21,false); expect(await row(art)).toEqual(before);
    await request(20,true); expect(await row(art)).toEqual(before);
    await request(22,true); expect(await row(art)).toMatchObject({ status: "queued", profile_snapshot: changed, image_prompt: null, attempts: 1 });
    expect((await claim(art)).attempts).toBe(2);
  });
  test("the selected male appearance reaches both the initial claim and an explicit redraw claim", async () => {
    const maleDetails = { gender: "male", ageRange: "20s", appearance: "긴 머리와 안경" };
    await profile(maleDetails); await save(); const art = await request();
    expect(await claim(art)).toMatchObject({ profile_snapshot: maleDetails, attempts: 1 });
    await finish(art);
    await request(21, true);
    expect(await row(art)).toMatchObject({ profile_snapshot: maleDetails, image_prompt: null, attempts: 1 });
    expect(await claim(art)).toMatchObject({ profile_snapshot: maleDetails, image_prompt: null, attempts: 2 });
  });
  test("a changed profile on retry discards the old prompt while unchanged retry reuses it", async () => {
    await profile(); const art = await picture("failed");
    await request(21); expect(await row(art)).toMatchObject({ image_prompt: "Existing saved prompt", profile_snapshot: details });
    await claim(art); await finish(art,"failed");
    const changed = { ...details, appearance: "긴 머리" }; await profile(changed);
    await request(22); expect(await row(art)).toMatchObject({ profile_snapshot: changed, image_prompt: null, attempts: 2 });
  });
  test("disabling personalization before retry clears the snapshot and old prompt", async () => {
    await profile(); const art = await picture("failed");
    await profile(details,false); await request(21);
    expect(await row(art)).toMatchObject({ profile_snapshot: {}, image_prompt: null });
  });
  test("blank and unspecified changes do not invalidate an equivalent effective snapshot", async () => {
    await profile({ occupation: "개발자" }); const art = await picture("failed");
    await profile({ occupation: " 개발자 ", gender: "unspecified", ageRange: "unspecified", appearance: "" }); await request(21);
    expect(await row(art)).toMatchObject({ profile_snapshot: { occupation: "개발자" }, image_prompt: "Existing saved prompt" });
  });
  test("profile changes cannot reset the daily attempt budget or deleted-day usage", async () => {
    await profile(); const art = await picture("failed");
    await worker(); await db.query("update public.daily_artworks set attempts=3 where id=$1", [art]); await user();
    await profile({ ...details, occupation: "학생" });
    await expect(request(21,true)).rejects.toThrow(/3회/);
    await db.query("select public.remove_team_entry($1)", [id(1)]); await save(2); const recreated = await request(22);
    expect(await row(recreated)).toMatchObject({ attempts: 3, status: "failed", profile_snapshot: { ...details, occupation: "학생" } });
  });
});
