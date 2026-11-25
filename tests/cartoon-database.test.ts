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
let past: string;
const pastMigration = "supabase/migrations/20261125125132_past_daily_cartoons.sql";
const retryMigration = "supabase/migrations/20261125165020_retry_unavailable_daily_cartoons.sql";
const publicColumns = "cartoon_date,status,stage,headline,summary,selection_reason,caption,sources,selected_at,completed_at,retry_after,error_message,created_at";
const enqueue = (day?: string) => day === undefined ? db.query<Job>("select * from public.enqueue_daily_cartoon()")
  : db.query<Job>("select * from public.enqueue_daily_cartoon($1::date)", [day]);
const claim = (day = today) => db.query<Job>("select * from public.claim_daily_cartoon($1::date)", [day]);
const manualClaim = (day = today, retryUnavailable: boolean | null = true) => db.query<Job>("select * from public.claim_daily_cartoon($1::date, $2::boolean)", [day, retryUnavailable]);
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
  await db.exec(await readFile(pastMigration, "utf8"));
  await db.exec(await readFile(retryMigration, "utf8"));
  today = (await db.query<{ day: string }>("select ((now() at time zone 'Asia/Seoul')::date)::text as day")).rows[0].day;
  past = (await db.query<{ day: string }>("select ((now() at time zone 'Asia/Seoul')::date - 30)::text as day")).rows[0].day;
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

  test.each(["future", "null", "infinity", "-infinity"])("enqueue and claim reject invalid dates (%s)", async kind => {
    const expression = kind === "future" ? "($1::date + 1)" : kind === "null" ? "null::date" : `'${kind}'::date`;
    const args = kind === "future" ? [today] : [];
    for (const rpc of ["enqueue_daily_cartoon", "claim_daily_cartoon"]) {
      await expect(db.query(`select * from public.${rpc}(${expression})`, args)).rejects.toThrow(/오늘 또는 지난 날짜/);
    }
    expect((await db.query("select * from public.daily_cartoons")).rows).toHaveLength(0);
  });

  test("past editions have their own shared row and budget without changing today's job", async () => {
    await enqueue();
    const todayBefore = (await db.query("select to_jsonb(c) as row from public.daily_cartoons c where cartoon_date=$1", [today])).rows;
    const enqueued = await Promise.all(Array.from({ length: 8 }, () => enqueue(past)));
    expect(enqueued.flatMap(r => r.rows)).toHaveLength(1);
    const claims = await Promise.all(Array.from({ length: 8 }, () => claim(past)));
    expect(claims.flatMap(r => r.rows)).toMatchObject([{ cartoon_date: new Date(`${past}T00:00:00Z`), status: "processing", attempts: 1 }]);
    expect((await enqueue(past)).rows).toHaveLength(0);
    expect((await claim(past)).rows).toHaveLength(0);
    expect((await db.query("select to_jsonb(c) as row from public.daily_cartoons c where cartoon_date=$1", [today])).rows).toEqual(todayBefore);
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

  test.each(["today", "past"])("%s failed jobs wait for the deadline, then resume drawing with a new token", async edition => {
    const day = edition === "past" ? past : today;
    await enqueue(day);
    const first = (await claim(day)).rows[0];
    await db.exec("update public.daily_cartoons set status='failed',image_prompt='An editorial illustration',headline='Saved news',retry_after=now()+interval '15 minutes',error_message='Temporary failure'");
    expect((await claim(day)).rows).toHaveLength(0);
    await db.exec("update public.daily_cartoons set retry_after=now()-interval '1 second'");
    const resumed = (await claim(day)).rows[0];
    expect(resumed).toMatchObject({ status: "processing", stage: "drawing", attempts: 2, image_prompt: "An editorial illustration", retry_after: null, error_message: null });
    expect(resumed.claim_token).not.toBe(first.claim_token);
    expect((await db.query("update public.daily_cartoons set status='ready' where cartoon_date=$1::date and status='processing' and claim_token=$2 returning cartoon_date", [day, first.claim_token])).rows).toHaveLength(0);
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

  test.each(["today", "past"])("%s stale claims recover up to three attempts, then stop terminally", async edition => {
    const day = edition === "past" ? past : today;
    await enqueue(day);
    let current = (await claim(day)).rows[0];
    await db.exec("update public.daily_cartoons set claimed_at=now()-interval '9 minutes'");
    expect((await claim(day)).rows).toHaveLength(0);
    for (const attempts of [2, 3]) {
      await db.exec("update public.daily_cartoons set claimed_at=now()-interval '11 minutes'");
      const next = (await claim(day)).rows[0];
      expect(next.attempts).toBe(attempts);
      expect(next.claim_token).not.toBe(current.claim_token);
      current = next;
    }
    await db.exec("update public.daily_cartoons set claimed_at=now()-interval '11 minutes'");
    expect((await claim(day)).rows).toHaveLength(0);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows[0]).toMatchObject({ status: "failed", attempts: 3, retry_after: null });
    await db.exec("update public.daily_cartoons set retry_after=now()-interval '1 second'");
    expect((await claim(day)).rows).toHaveLength(0);
    expect((await enqueue(day)).rows).toHaveLength(0);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows[0].attempts).toBe(3);
  });

  test.each(["ready", "unavailable"].flatMap(status => ["today", "past"].map(edition => ({ status, edition }))))("$edition $status is never reset by enqueue or automatically regenerated", async ({ status, edition }) => {
    const day = edition === "past" ? past : today;
    await enqueue(day); await claim(day);
    await db.query("update public.daily_cartoons set status=$1,headline='Existing result',sources='[{\"url\":\"https://example.test/news\"}]',image_path='existing.png',completed_at=now(),claimed_at=now()-interval '11 minutes',retry_after=now()-interval '1 minute'", [status]);
    const snapshot = async () => (await db.query("select to_jsonb(c) as row from public.daily_cartoons c")).rows;
    const before = await snapshot();
    expect((await enqueue(day)).rows).toHaveLength(0);
    expect((await claim(day)).rows).toHaveLength(0);
    expect((await manualClaim(day, false)).rows).toHaveLength(0);
    expect((await manualClaim(day, null)).rows).toHaveLength(0);
    if (status === "ready") expect((await manualClaim(day)).rows).toHaveLength(0);
    expect(await snapshot()).toEqual(before);
  });

  test.each(["today", "past"])("%s legacy unavailable editions can be explicitly retried once without resetting the budget", async edition => {
    const day = edition === "past" ? past : today;
    await enqueue(day);
    const first = (await claim(day)).rows[0];
    await db.exec("update public.daily_cartoons set status='unavailable',retry_after=null,completed_at=now(),error_message='No reliable evidence'");
    expect((await enqueue(day)).rows).toHaveLength(0);
    expect((await claim(day)).rows).toHaveLength(0);
    // PGlite serializes its connection: overlapping callers must still consume
    // exactly one attempt. The production function retains FOR UPDATE SKIP LOCKED.
    const responses = await Promise.all(Array.from({ length: 8 }, () => manualClaim(day)));
    const winners = responses.flatMap(r => r.rows);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({ status: "processing", stage: "searching", attempts: 2, retry_after: null, error_message: null, completed_at: null });
    expect(winners[0].claim_token).not.toBe(first.claim_token);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows[0].attempts).toBe(2);
    expect((await db.query("update public.daily_cartoons set status='ready' where cartoon_date=$1::date and status='processing' and claim_token=$2 returning cartoon_date", [day, first.claim_token])).rows).toHaveLength(0);
  });

  test.each(["today", "past"])("%s unavailable editions respect cooldown and the three-attempt ceiling", async edition => {
    const day = edition === "past" ? past : today;
    await enqueue(day); await claim(day);
    await db.exec("update public.daily_cartoons set status='unavailable',retry_after=now()+interval '15 minutes'");
    expect((await manualClaim(day)).rows).toHaveLength(0);
    expect((await db.query<Job>("select * from public.daily_cartoons")).rows[0].attempts).toBe(1);
    await db.exec("update public.daily_cartoons set retry_after=now()-interval '1 second'");
    expect((await claim(day)).rows).toHaveLength(0);
    expect((await manualClaim(day)).rows[0]).toMatchObject({ status: "processing", stage: "searching", attempts: 2 });
    await db.exec("update public.daily_cartoons set status='unavailable',retry_after=null");
    expect((await manualClaim(day)).rows[0]).toMatchObject({ attempts: 3 });
    for (const deadline of ["null", "now()-interval '1 second'"]) {
      await db.exec(`update public.daily_cartoons set status='unavailable',retry_after=${deadline}`);
      const before = (await db.query("select to_jsonb(c) as row from public.daily_cartoons c")).rows;
      expect((await manualClaim(day)).rows).toHaveLength(0);
      expect((await enqueue(day)).rows).toHaveLength(0);
      expect((await db.query("select to_jsonb(c) as row from public.daily_cartoons c")).rows).toEqual(before);
    }
  });

  test.each(["ready", "unavailable"])("the additive migrations preserve %s editions, attempts and timestamps", async status => {
    await enqueue(past); await claim(past);
    await db.query("update public.daily_cartoons set status=$1,headline='Saved edition',summary='Saved summary',image_path='existing.png',completed_at=now(),attempts=2", [status]);
    const before = (await db.query("select to_jsonb(c) as row from public.daily_cartoons c")).rows;
    await db.exec("reset role");
    await db.exec(await readFile(pastMigration, "utf8"));
    await db.exec(await readFile(retryMigration, "utf8"));
    await asWorker();
    expect((await db.query("select to_jsonb(c) as row from public.daily_cartoons c")).rows).toEqual(before);
  });

  test("RPC signatures keep legacy calls unambiguous without security-definer privileges", async () => {
    const signatures = (await db.query("select p.pronargs,p.proargnames,p.pronargdefaults,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='claim_daily_cartoon' order by p.pronargs")).rows;
    expect(signatures).toEqual([
      { pronargs: 1, proargnames: ["p_date"], pronargdefaults: 0, prosecdef: false, proconfig: ['search_path=""'] },
      { pronargs: 2, proargnames: ["p_date", "p_retry_unavailable"], pronargdefaults: 0, prosecdef: false, proconfig: ['search_path=""'] },
    ]);
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
    await expect(manualClaim()).rejects.toThrow(/permission denied/);
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
