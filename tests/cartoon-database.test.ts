import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

type Job = {
  cartoon_date: Date;
  status: string;
  stage: string;
  attempts: number;
  claim_token: string | null;
  image_prompt: string | null;
  retry_after: Date | null;
};
let db: PGlite;
let today: string;
const publicColumns = "cartoon_date,status,stage,headline,summary,selection_reason,caption,sources,selected_at,completed_at,retry_after,error_message,created_at";
const enqueue = () => db.query<Job>("select * from public.enqueue_daily_cartoon()");
const claim = () => db.query<Job>("select * from public.claim_daily_cartoon($1::date)", [today]);
const asWorker = () => db.exec("reset role; set role service_role");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema storage;
    grant usage on schema public,storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant all on storage.objects to anon,authenticated,service_role;
    -- Simulate an unrelated broad policy: the new bucket still must stay server-only.
    create policy existing_storage_policy on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.buckets values('existing-bucket','Existing',true,1024,array['image/png']);
  `);
  await db.exec(await readFile("supabase/migrations/20261125103138_daily_editorial_cartoons.sql", "utf8"));
  today = (await db.query<{ day: string }>("select ((now() at time zone 'Asia/Seoul')::date)::text as day")).rows[0].day;
}, 30000);

beforeEach(async () => {
  await db.exec("reset role; truncate public.daily_cartoons; truncate storage.objects");
  await asWorker();
});
afterAll(async () => { await db?.close(); });

describe("daily editorial cartoon database", () => {
  test("concurrent enqueue requests create only today's single shared job", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => enqueue()));
    expect(responses.flatMap(r => r.rows)).toHaveLength(1);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows).toMatchObject([
      { cartoon_date: new Date(`${today}T00:00:00Z`), status: "queued", stage: "searching", attempts: 0, claim_token: null },
    ]);
  });

  test.each(["-1", "1", "null"])("enqueue and claim reject a non-today date (%s)", async offset => {
    const expression = offset === "null" ? "null::date" : `($1::date + ${offset})`;
    const args = offset === "null" ? [] : [today];
    for (const rpc of ["enqueue_daily_cartoon", "claim_daily_cartoon"]) {
      await expect(db.query(`select * from public.${rpc}(${expression})`, args)).rejects.toThrow(/오늘 날짜/);
    }
    expect((await db.query("select * from public.daily_cartoons")).rows).toHaveLength(0);
  });

  test("duplicate claims have one winner and do not consume additional attempts", async () => {
    await enqueue();
    // PGlite serializes its connection; this checks overlapping callers, not
    // independent production connections contending for a PostgreSQL row lock.
    const responses = await Promise.all(Array.from({ length: 8 }, () => claim()));
    const winners = responses.flatMap(r => r.rows);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ status: "processing", attempts: 1, stage: "searching" });
    expect(winners[0].claim_token).toMatch(/^[0-9a-f-]{36}$/);
    expect((await claim()).rows).toHaveLength(0);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows[0].attempts).toBe(1);
  });

  test("failed jobs wait for the 15-minute deadline, then resume drawing with a new token", async () => {
    await enqueue();
    const first = (await claim()).rows[0];
    await db.exec("update public.daily_cartoons set status='failed',image_prompt='An editorial illustration',headline='Saved news',retry_after=now()+interval '15 minutes',error_message='Temporary failure'");
    expect((await claim()).rows).toHaveLength(0);
    await db.exec("update public.daily_cartoons set retry_after=now()-interval '1 second'");
    const resumed = (await claim()).rows[0];
    expect(resumed).toMatchObject({ status: "processing", stage: "drawing", attempts: 2, image_prompt: "An editorial illustration", retry_after: null, error_message: null });
    expect(resumed.claim_token).not.toBe(first.claim_token);
    expect((await db.query("update public.daily_cartoons set status='ready' where cartoon_date=$1::date and status='processing' and claim_token=$2 returning cartoon_date", [today, first.claim_token])).rows).toHaveLength(0);
  });

  test("a failed job without an explicit retry deadline cannot be reclaimed", async () => {
    await enqueue(); await claim();
    await db.exec("update public.daily_cartoons set status='failed',retry_after=null");
    expect((await claim()).rows).toHaveLength(0);
  });

  test("a missing job or a processing job without an expiry timestamp is not claimable", async () => {
    expect((await claim()).rows).toHaveLength(0);
    await enqueue(); await claim();
    await db.exec("update public.daily_cartoons set claimed_at=null");
    expect((await claim()).rows).toHaveLength(0);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows[0].attempts).toBe(1);
  });

  test("stale claims recover up to three attempts, then stop terminally", async () => {
    await enqueue();
    let current = (await claim()).rows[0];
    await db.exec("update public.daily_cartoons set claimed_at=now()-interval '9 minutes'");
    expect((await claim()).rows).toHaveLength(0);
    for (const attempts of [2, 3]) {
      await db.exec("update public.daily_cartoons set claimed_at=now()-interval '11 minutes'");
      const next = (await claim()).rows[0];
      expect(next.attempts).toBe(attempts);
      expect(next.claim_token).not.toBe(current.claim_token);
      current = next;
    }
    await db.exec("update public.daily_cartoons set claimed_at=now()-interval '11 minutes'");
    expect((await claim()).rows).toHaveLength(0);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows[0]).toMatchObject({ status: "failed", attempts: 3, retry_after: null });
    await db.exec("update public.daily_cartoons set retry_after=now()-interval '1 second'");
    expect((await claim()).rows).toHaveLength(0);
    expect((await enqueue()).rows).toHaveLength(0);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows[0].attempts).toBe(3);
  });

  test.each(["ready", "unavailable"])("%s is never reset or regenerated", async status => {
    await enqueue(); await claim();
    await db.query("update public.daily_cartoons set status=$1,headline='Existing result',sources='[{\"url\":\"https://example.test/news\"}]',image_path='existing.png',completed_at=now(),claimed_at=now()-interval '11 minutes',retry_after=now()-interval '1 minute'", [status]);
    const snapshot = async () => (await db.query("select to_jsonb(c) as row from public.daily_cartoons c")).rows;
    const before = await snapshot();
    expect((await enqueue()).rows).toHaveLength(0);
    expect((await claim()).rows).toHaveLength(0);
    expect(await snapshot()).toEqual(before);
  });

  test("the table rejects invalid status, stage, attempts, sources and oversized public text", async () => {
    await enqueue();
    for (const patch of ["status='unknown'", "stage='uploading'", "attempts=4", "attempts=-1", "sources='{}'", "headline=repeat('x',201)"]) {
      await expect(db.exec(`update public.daily_cartoons set ${patch}`)).rejects.toThrow();
    }
    await expect(db.query("update public.daily_cartoons set sources=$1::jsonb", [JSON.stringify(Array.from({ length: 11 }, () => ({})))])).rejects.toThrow();
  });

  test("authenticated readers see public fields but cannot read worker details or mutate jobs", async () => {
    await enqueue();
    await db.exec("update public.daily_cartoons set headline='Public news',image_prompt='Internal prompt',image_path='private.png'");
    await db.exec("reset role; set role authenticated");
    expect((await db.query(`select ${publicColumns} from public.daily_cartoons`)).rows).toMatchObject([{ headline: "Public news" }]);
    for (const columns of ["*", "claim_token", "claimed_at", "image_prompt", "image_path", "attempts"]) {
      await expect(db.query(`select ${columns} from public.daily_cartoons`)).rejects.toThrow(/permission denied/);
    }
    for (const command of ["insert into public.daily_cartoons(cartoon_date) values(current_date)", "update public.daily_cartoons set headline='Changed'", "delete from public.daily_cartoons", "truncate public.daily_cartoons"]) {
      await expect(db.exec(command)).rejects.toThrow(/permission denied/);
    }
  });

  test.each(["anon", "authenticated"])("%s cannot execute worker RPCs", async role => {
    await db.exec(`reset role; set role ${role}`);
    await expect(enqueue()).rejects.toThrow(/permission denied/);
    await expect(claim()).rejects.toThrow(/permission denied/);
    if (role === "anon") await expect(db.query(`select ${publicColumns} from public.daily_cartoons`)).rejects.toThrow(/permission denied/);
  });

  test("the news bucket is private and client Storage access is blocked without changing other buckets", async () => {
    await db.exec("reset role");
    const buckets = (await db.query<{ id: string; public: boolean; file_size_limit: number; allowed_mime_types: string[] }>("select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id")).rows;
    expect(buckets).toEqual([
      { id: "existing-bucket", public: true, file_size_limit: 1024, allowed_mime_types: ["image/png"] },
      { id: "news-cartoons", public: false, file_size_limit: 10485760, allowed_mime_types: ["image/png", "image/webp"] },
    ]);
    await asWorker();
    await db.exec("insert into storage.objects(bucket_id,name) values('news-cartoons','shared.png'),('existing-bucket','existing.png')");
    expect((await db.query("select name from storage.objects where bucket_id='news-cartoons'")).rows).toEqual([{ name: "shared.png" }]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      expect((await db.query("select name from storage.objects order by name")).rows).toEqual([{ name: "existing.png" }]);
      await expect(db.exec("insert into storage.objects(bucket_id,name) values('news-cartoons','forbidden.png')")).rejects.toThrow(/row-level security/);
      expect((await db.query("delete from storage.objects where bucket_id='news-cartoons' returning name")).rows).toHaveLength(0);
      expect((await db.query("update storage.objects set name='forbidden.png' where bucket_id='news-cartoons' returning name")).rows).toHaveLength(0);
    }
  });
});
