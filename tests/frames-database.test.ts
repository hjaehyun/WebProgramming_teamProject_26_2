import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// supabase/migrations/20261125090000_artwork_frames_anime.sql on actual PostgreSQL.
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const entryId = "00000000-0000-4000-8000-000000000011";
const id = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
let db: PGlite;
let today: string, yesterday: string;

async function asUser(user = alice) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function asWorker() { await db.exec("reset role; set role service_role"); }
async function asOwner() { await db.exec("reset role"); }
async function request(n: number, redraw = false, day = today) {
  return (await db.query<{ id: string }>("select public.request_team_artwork($1::date,$2,$3) as id", [day, redraw, id(n)])).rows[0].id;
}
async function claim(art: string) {
  await asWorker();
  await db.query("select * from public.claim_artwork($1)", [art]);
  await asUser();
}
async function finish(art: string) {
  await asWorker();
  await db.query("update public.daily_artworks set status='ready',title='꽃',scene_summary='꽃을 본 하루',image_prompt='a flower',image_path=user_id::text||'/'||id::text||'/a.png' where id=$1", [art]);
  await asUser();
}
async function readyToday() {
  await db.query("select public.save_team_entry($1,$2,$3::date)", [entryId, "산책하며 작은 꽃을 보았다.", today]);
  const art = await request(1); await claim(art); await finish(art); return art;
}
const setFrame = async (frame: string, day = today) =>
  (await db.query<{ frame: string | null }>("select public.set_artwork_frame($1::date,$2) as frame", [day, frame])).rows[0].frame;
async function frameOf(art: string) {
  await asOwner();
  const frame = (await db.query<{ frame: string }>("select frame from public.daily_artworks where id=$1", [art])).rows[0].frame;
  await asUser();
  return frame;
}

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
  for (const file of ["202611040001_initial", "20261111104704_team_frontend_integration", "20261115090000_artwork_songs", "20261120064000_edit_finished_days"]) {
    await db.exec(await readFile(`supabase/migrations/${file}.sql`, "utf8"));
  }
  const days = (await db.query<Record<string, string>>(`select d::text as today,(d-1)::text as yesterday from (select (now() at time zone 'Asia/Seoul')::date d) s`)).rows[0];
  ({ today, yesterday } = days);
  // A picture drawn before this migration must come through it untouched, as the basic frame.
  await db.query("insert into auth.users values($1)", [alice]);
  await db.query("insert into public.daily_artworks(user_id,artwork_date,art_style,status,entry_snapshot) values($1,$2::date,'watercolor','ready','[]'::jsonb)", [alice, yesterday]);
  await db.exec(await readFile("supabase/migrations/20261125090000_artwork_frames_anime.sql", "utf8"));
  expect((await db.query("select artwork_date::text as day,art_style,status,frame from public.daily_artworks")).rows)
    .toEqual([{ day: yesterday, art_style: "watercolor", status: "ready", frame: "basic" }]);
}, 30000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade");
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.exec("update public.profiles set ai_consent_at=now(),onboarded=true");
  await asUser();
});
afterAll(async () => { await db?.close(); });

describe("artwork frames on actual PostgreSQL", () => {
  test("a new picture starts with the basic frame", async () => {
    const art = await readyToday();
    expect(await frameOf(art)).toBe("basic");
  });

  test("the owner sets a frame and it survives a redraw", async () => {
    const art = await readyToday();
    expect(await setFrame("wood")).toBe("wood");
    expect(await frameOf(art)).toBe("wood");
    await request(2, true);
    expect(await frameOf(art)).toBe("wood");
  });

  test("another person, signed-out callers and unknown frames cannot change it", async () => {
    const art = await readyToday();
    await asUser(bob);
    expect(await setFrame("tape")).toBeNull();
    await asUser();
    expect(await frameOf(art)).toBe("basic");
    await db.exec("reset role; set role anon");
    await expect(setFrame("tape")).rejects.toThrow();
    await asUser();
    await expect(setFrame("gold")).rejects.toThrow();
    await expect(db.query("update public.daily_artworks set frame='diary'")).rejects.toThrow(/permission/);
    expect(await frameOf(art)).toBe("basic");
  });

  test("a day without a picture returns null", async () => {
    expect(await setFrame("diary", yesterday)).toBeNull();
  });

  test("profiles accept the anime style and a new picture copies it", async () => {
    await db.query("update public.profiles set art_style='anime' where id=$1", [alice]);
    await db.query("select public.save_team_entry($1,$2,$3::date)", [entryId, "구름이 높았다.", today]);
    const art = await request(3);
    await asOwner();
    expect((await db.query("select art_style from public.daily_artworks where id=$1", [art])).rows).toEqual([{ art_style: "anime" }]);
    await asUser();
    await expect(db.query("update public.profiles set art_style='oil' where id=$1", [alice])).rejects.toThrow();
  });
});
