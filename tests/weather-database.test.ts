import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const entryId = "00000000-0000-4000-8000-000000000011";
let db: PGlite;
let today: string;

async function asUser(id = alice) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
const add = () => db.query("select public.save_team_entry($1,$2,$3::date)", [entryId, "산책하며 작은 꽃을 보았다.", today]);
const setWeather = (code: string | null, temp: number | null, id = entryId) =>
  db.query("select public.set_entry_weather($1,$2,$3)", [id, code, temp]);
const weather = async () => {
  await db.exec("reset role");
  const rows = (await db.query<{ weather_code: string | null; temp_c: string | null }>("select weather_code,temp_c from public.entries")).rows;
  await asUser();
  return rows;
};

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
  await db.exec(await readFile("supabase/migrations/202611040001_initial.sql", "utf8"));
  await db.exec(await readFile("supabase/migrations/20261111104704_team_frontend_integration.sql", "utf8"));
  // An entry written before the weather migration must survive it untouched.
  await db.query("insert into auth.users values($1)", [alice]);
  await db.exec("update public.profiles set ai_consent_at=now(),onboarded=true");
  await db.query("insert into public.entries(user_id,content) values($1,'예전 기록')", [alice]);
  await db.exec(await readFile("supabase/migrations/20261112003000_entry_weather.sql", "utf8"));
  expect((await db.query("select content,weather_code,temp_c from public.entries")).rows).toEqual([{ content: "예전 기록", weather_code: null, temp_c: null }]);
  today = (await db.query<{ day: string }>("select ((now() at time zone 'Asia/Seoul')::date)::text as day")).rows[0].day;
}, 30000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade");
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.exec("update public.profiles set ai_consent_at=now(),onboarded=true");
  await asUser();
});
afterAll(async () => { await db?.close(); });

describe("entry weather migration on actual PostgreSQL", () => {
  test("weather is attached once to the caller's own fragment", async () => {
    await add();
    expect(await weather()).toEqual([{ weather_code: null, temp_c: null }]);
    await setWeather("rain", 17.26);
    expect(await weather()).toEqual([{ weather_code: "rain", temp_c: "17.3" }]);
    await setWeather("clear", 30); // a second write is ignored
    expect(await weather()).toEqual([{ weather_code: "rain", temp_c: "17.3" }]);
  });

  test("another person, an unknown word or an impossible temperature cannot write", async () => {
    await add();
    await asUser(bob);
    await setWeather("rain", 10);
    expect(await weather()).toEqual([{ weather_code: null, temp_c: null }]);
    await expect(setWeather("tornado", 10)).rejects.toThrow();
    await expect(setWeather("rain", 99)).rejects.toThrow();
    await expect(setWeather(null, 10)).rejects.toThrow(/날씨/);
    await db.exec("reset role; set role anon");
    await expect(setWeather("rain", 10)).rejects.toThrow();
    await asUser();
    await expect(db.query("update public.entries set weather_code='snow',temp_c=1")).rejects.toThrow(/permission/);
    expect(await weather()).toEqual([{ weather_code: null, temp_c: null }]);
  });

  test("a past day's fragment cannot receive weather", async () => {
    await add();
    await db.exec("reset role");
    await db.exec("update public.entries set entry_date=entry_date-1");
    await asUser();
    await setWeather("rain", 10);
    expect(await weather()).toEqual([{ weather_code: null, temp_c: null }]);
  });

  test("the artwork snapshot still holds only content and time", async () => {
    await add();
    await setWeather("snow", -2);
    await db.query("select public.close_day($1::date)", [today]);
    await db.exec("reset role");
    const snap = (await db.query<{ entry_snapshot: Record<string, unknown>[] }>("select entry_snapshot from public.daily_artworks")).rows[0].entry_snapshot;
    expect(Object.keys(snap[0]).sort()).toEqual(["content", "created_at"]);
  });
});
