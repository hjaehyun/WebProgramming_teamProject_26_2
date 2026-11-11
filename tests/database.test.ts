import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
let db: PGlite;
let today: string;
async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}
async function closeDay() {
  const r = await db.query<{ id: string }>("select public.close_day($1::date) as id", [today]);
  return r.rows[0].id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select on storage.objects to anon, authenticated;
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
  `);
  await db.exec(await readFile("supabase/migrations/202611040001_initial.sql", "utf8"));
  const date = await db.query<{ day: string }>("select ((now() at time zone 'Asia/Seoul')::date)::text as day");
  today = date.rows[0].day;
}, 30000);
beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade");
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.exec("update public.profiles set ai_consent_at=now()");
  await asUser(alice);
});
afterAll(async () => { await db?.close(); });
describe("actual PostgreSQL migration, RLS and generation lifecycle", () => {
  test("users can only read their own entries and profiles", async () => {
    await db.query("select public.add_entry($1)", ["Alice private entry"]);
    await asUser(bob);
    expect((await db.query("select * from public.entries")).rows).toHaveLength(0);
    expect((await db.query("select * from public.profiles")).rows).toHaveLength(1);
  });
  test("direct inserts and privileged job RPCs cannot bypass protections", async () => {
    await expect(db.query("insert into public.entries(user_id,content) values($1,'bypass')", [alice])).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.close_day_for($1,$2::date)", [bob, today])).rejects.toThrow(/permission denied/);
    await expect(db.exec("select public.claim_artwork(null)")).rejects.toThrow(/permission denied/);
  });
  test("empty days and future days cannot generate", async () => {
    await expect(closeDay()).rejects.toThrow(/조각글/);
    await db.exec("select public.add_entry('test')");
    await expect(db.exec("select public.close_day(current_date+2)")).rejects.toThrow(/미래/);
  });
  test("daily close is idempotent and freezes notes", async () => {
    const row = await db.query<{ id: string }>("select (public.add_entry('keep this')).id");
    const id = await closeDay();
    expect(await closeDay()).toBe(id);
    expect((await db.query("select * from public.daily_artworks")).rows).toHaveLength(1);
    await expect(db.exec("select public.add_entry('too late')")).rejects.toThrow(/이미 마감/);
    await expect(db.query("select public.remove_entry($1)", [row.rows[0].id])).rejects.toThrow(/마감된/);
  });
  test("cannot delete another user's note", async () => {
    const row = await db.query<{ id: string }>("select (public.add_entry('private')).id");
    await asUser(bob);
    await expect(db.query("select public.remove_entry($1)", [row.rows[0].id])).rejects.toThrow(/찾을 수/);
  });
  test("daily note quota enforced in database", async () => {
    for (let i = 0; i < 30; i++) await db.exec("select public.add_entry('small moment')");
    await expect(db.exec("select public.add_entry('one too many')")).rejects.toThrow(/30개/);
  });
  test("consent required before any day is closed", async () => {
    await db.exec("update public.profiles set ai_consent_at=null");
    await db.exec("select public.add_entry('text only')");
    await expect(closeDay()).rejects.toThrow(/동의/);
  });
  test("job claim is exclusive and stale recovery changes fencing token", async () => {
    await db.exec("select public.add_entry('hello')");
    const id = await closeDay();
    await db.exec("reset role; set role service_role");
    const first = (await db.query<{ claim_token: string; attempts: number }>("select * from public.claim_artwork($1)", [id])).rows[0];
    expect(first.attempts).toBe(1);
    expect((await db.query("select * from public.claim_artwork($1)", [id])).rows).toHaveLength(0);
    await db.exec("update public.daily_artworks set claimed_at=now()-interval '11 minutes'");
    const second = (await db.query<{ claim_token: string }>("select * from public.claim_artwork($1)", [id])).rows[0];
    expect(second.claim_token).not.toBe(first.claim_token);
    const staleUpdate = await db.query("update public.daily_artworks set status='ready' where id=$1 and claim_token=$2 returning id", [id, first.claim_token]);
    expect(staleUpdate.rows).toHaveLength(0);
  });
  test("retry cannot exceed three attempts or affect another user", async () => {
    await db.exec("select public.add_entry('hello')");
    const id = await closeDay();
    await db.exec("reset role; update public.daily_artworks set status='failed',attempts=1");
    await asUser(bob);
    await expect(db.query("select public.retry_artwork($1)", [id])).rejects.toThrow(/다시 시도/);
    await asUser(alice);
    await db.query("select public.retry_artwork($1)", [id]);
    await db.exec("reset role; update public.daily_artworks set status='failed',attempts=3");
    await asUser(alice);
    await expect(db.query("select public.retry_artwork($1)", [id])).rejects.toThrow(/최대 3회/);
  });
  test("automated close skips today, catches up older days, and is idempotent", async () => {
    await db.exec("reset role");
    await db.query("insert into public.entries(user_id,content,entry_date) values($1,'yesterday', $2::date-1),($1,'today',$2::date)", [alice, today]);
    await db.exec("set role service_role");
    expect((await db.query<{ n: number }>("select public.enqueue_closed_days() as n")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select public.enqueue_closed_days() as n")).rows[0].n).toBe(0);
  });
  test("private storage objects visible only to owner; anonymous sees none", async () => {
    await db.exec("reset role; truncate storage.objects");
    await db.query("insert into storage.objects(bucket_id,name) values('artworks',$1),('artworks',$2)", [`${alice}/one.png`, `${bob}/two.png`]);
    await asUser(alice);
    expect((await db.query("select name from storage.objects")).rows).toEqual([{ name: `${alice}/one.png` }]);
    await db.exec("reset role; set role anon");
    expect((await db.query("select name from storage.objects")).rows).toHaveLength(0);
    await expect(db.exec("select * from public.entries")).rejects.toThrow(/permission denied/);
  });
});
