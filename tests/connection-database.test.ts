import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// One PGlite connection serializes overlapping calls. These assertions cover both transition
// orders and SQL permissions; they do not pretend to exercise independent PostgreSQL sessions.
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const id = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
type Job = { id: string; user_id: string; status: string; stage: string; attempts: number; entry_snapshot: unknown[]; artwork_summary: string | null; artwork_tags: string[]; input_fingerprint: string | null; claim_token: string | null; claimed_at: Date | null; image_path: string | null; image_prompt: string | null; retry_after: Date | null; topics: unknown[]; sources: unknown[] };
let db: PGlite, today: string, yesterday: string, tomorrow: string;
const owner = () => db.exec("reset role");
async function user(who = alice) {
  await owner(); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec("set role authenticated");
}
const worker = () => db.exec("reset role; set role service_role");
const request = async (n = 1, refresh = false, day = yesterday) => (await db.query<{ id: string }>("select public.request_daily_connection($1::date,$2,$3) as id", [day, refresh, id(n)])).rows[0].id;
const save = (n = 50, content = "산책하며 꽃을 보았다", day = yesterday) => db.query("select public.save_team_entry($1,$2,$3::date)", [id(n), content, day]);
const remove = (n = 50) => db.query("select public.remove_team_entry($1)", [id(n)]);
async function claim(job: string | null) { await worker(); const result = await db.query<Job>("select * from public.claim_daily_connection($1)", [job]); await user(); return result.rows; }
async function row(job: string) { await owner(); const value = (await db.query<Job>("select * from public.daily_connections where id=$1", [job])).rows[0]; await user(); return value; }
async function change(job: string, sql: string) { await owner(); await db.query(`update public.daily_connections set ${sql} where id=$1`, [job]); await user(); }
async function count(table: string) { await owner(); const n = (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n; await user(); return n; }
async function newJob() { await save(); return request(); }
const expire = (job: string) => change(job, "claimed_at=now()-interval '11 minutes'");

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

    -- The dispatcher runs against local inert substitutes: no cron runs and no HTTP is sent.
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
  for (const file of ["202611040001_initial", "20261111104704_team_frontend_integration", "20261120064000_edit_finished_days", "20261125111300_past_day_drafts", "20261125121748_daily_connections"]) {
    await db.exec(await readFile(`supabase/migrations/${file}.sql`, "utf8"));
  }
  const days = (await db.query<{ today: string; yesterday: string; tomorrow: string }>("select d::text as today,(d-1)::text as yesterday,(d+1)::text as tomorrow from (select (now() at time zone 'Asia/Seoul')::date d) s")).rows[0];
  ({ today, yesterday, tomorrow } = days);
}, 30000);

beforeEach(async () => {
  await owner();
  await db.exec(`truncate auth.users cascade; truncate net.http_request_queue,net._http_response,vault.secrets,vault.decrypted_secrets,harujogak_private.connection_worker_dispatches;
    update harujogak_private.connection_worker_control set enabled=false,last_tick=null,last_request_id=null,last_dispatched_at=null,last_outcome='disabled',last_maintenance=null;`);
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.exec("update public.profiles set ai_consent_at=now()"); await user();
});
afterAll(async () => { await db?.close(); });

describe("private connection requests and source snapshots", () => {
  test("first request snapshots only owned fragments and ready artwork data in deterministic order", async () => {
    await save(51, "두 번째 조각"); await save(50, "첫 번째 조각");
    await owner();
    await db.exec("update public.entries set created_at='2026-01-01T00:00:00Z'");
    await db.query("insert into public.entries(user_id,entry_date,content) values($1,$2,'다른 사람 비밀')", [bob, yesterday]);
    await db.query("insert into public.daily_artworks(user_id,artwork_date,status,art_style,entry_snapshot,scene_summary,tags) values($1,$2,'ready','watercolor','[]','꽃을 본 하루',array['꽃','산책'])", [alice, yesterday]);
    await user(); const job = await request();
    expect(await row(job)).toMatchObject({ user_id: alice, status: "queued", stage: "topics", attempts: 1, artwork_summary: "꽃을 본 하루", artwork_tags: ["꽃", "산책"] });
    expect((await row(job)).entry_snapshot).toEqual([{ content: "첫 번째 조각", created_at: "2026-01-01T00:00:00+00:00" }, { content: "두 번째 조각", created_at: "2026-01-01T00:00:00+00:00" }]);
    expect(JSON.stringify(await row(job))).not.toContain("다른 사람 비밀");
    expect((await row(job)).input_fingerprint).toMatch(/^[a-f0-9]{32}$/);
    const window = (await db.query<{ days: number }>("select extract(epoch from news_to-news_from)/86400 as days from public.daily_connections")).rows[0];
    expect(Number(window.days)).toBe(7);
  });

  test("missing or unfinished artwork does not block a diary connection or leak an old summary", async () => {
    await save(); await owner();
    await db.query("insert into public.daily_artworks(user_id,artwork_date,status,art_style,entry_snapshot,scene_summary,tags) values($1,$2,'failed','watercolor','[]','미완성 요약',array['이전'])", [alice, yesterday]);
    await user(); expect(await row(await request())).toMatchObject({ artwork_summary: null, artwork_tags: [] });
  });

  test("legacy artwork input is bounded without changing the original picture", async () => {
    await save(); await owner();
    const tags = [null, "   ", ...Array.from({ length: 25 }, (_, i) => `${i} ` + "가".repeat(250))];
    await db.query("insert into public.daily_artworks(user_id,artwork_date,status,art_style,entry_snapshot,scene_summary,tags) values($1,$2,'ready','watercolor','[]',$3,$4)", [alice, yesterday, "요".repeat(2500), tags]);
    await user(); const job = await request(); const copied = await row(job);
    expect(copied.artwork_summary).toHaveLength(2000); expect(copied.artwork_tags).toHaveLength(20);
    expect(copied.artwork_tags.every(tag => tag.length === 200)).toBe(true);
    const original = (await db.query<{ summary: number; tags: number }>("select char_length(scene_summary) as summary,cardinality(tags) as tags from public.daily_artworks")).rows[0];
    expect(original).toEqual({ summary: 2500, tags: 27 });
    await worker(); const input = (await db.query<{ fingerprint: string }>("select public.current_connection_input($1,$2)->>'input_fingerprint' as fingerprint", [alice, yesterday])).rows[0];
    expect(input.fingerprint).toBe(copied.input_fingerprint);
  });

  test("the input helper is service-only and changes its fingerprint when the owned journal changes", async () => {
    const job = await newJob(); const old = (await row(job)).input_fingerprint;
    await expect(db.query("select public.current_connection_input($1,$2)", [alice, yesterday])).rejects.toThrow(/permission denied/);
    await db.query("select public.edit_entry($1,'새로 고친 기록')", [id(50)]);
    await worker(); const input = (await db.query<{ input: Record<string, unknown> }>("select public.current_connection_input($1,$2) as input", [alice, yesterday])).rows[0].input;
    expect(input.input_fingerprint).not.toBe(old); expect((await row(job)).input_fingerprint).toBe(old);
    expect((await row(job)).attempts).toBe(1);
  });

  test("overlapping requests share one row and reserve a single attempt", async () => {
    await save(); const results = await Promise.all(Array.from({ length: 5 }, (_, i) => request(i + 1)));
    expect(new Set(results).size).toBe(1); expect((await row(results[0])).attempts).toBe(1);
    expect(await count("public.daily_connections")).toBe(1);
  });

  test.each(["ready", "no_match"])("%s is cached until explicit refresh, preserving the old image until replacement", async status => {
    const job = await newJob(); await change(job, `status='${status}',image_path='old-private-image.png',entry_snapshot='[]'`);
    expect(await request(2)).toBe(job); expect((await row(job)).attempts).toBe(1);
    await db.query("select public.edit_entry($1,'바뀐 내용')", [id(50)]);
    await request(3, true); const refreshed = await row(job);
    expect(refreshed).toMatchObject({ attempts: 2, status: "queued", stage: "topics", image_path: "old-private-image.png", claim_token: null });
    expect(refreshed.entry_snapshot).toEqual([expect.objectContaining({ content: "바뀐 내용" })]);
    await change(job, `status='${status}'`); await request(3, true); expect((await row(job)).attempts).toBe(2);
    await request(4, true); await change(job, `status='${status}'`);
    await expect(request(5, true)).rejects.toThrow(/3회/); expect(await request(6)).toBe(job);
  });

  test("failed retries wait five minutes, require a new request ID and capture fresh input", async () => {
    const job = await newJob(); await change(job, "status='failed',retry_after=now()+interval '5 minutes'");
    expect(await request()).toBe(job);
    await expect(request(2)).rejects.toThrow(/5분/);
    await change(job, "retry_after=now()-interval '1 second'");
    await db.query("select public.edit_entry($1,'재시도할 최신 조각')", [id(50)]);
    await request(2); expect(await row(job)).toMatchObject({ attempts: 2, status: "queued", retry_after: null });
    expect((await row(job)).entry_snapshot).toEqual([expect.objectContaining({ content: "재시도할 최신 조각" })]);
  });

  test("an older paid request ID stays idempotent after a newer refresh completes", async () => {
    const job = await newJob(); await change(job, "status='ready'");
    await request(2, true); await change(job, "status='ready'");
    expect(await request(1, true)).toBe(job); expect((await row(job)).attempts).toBe(2);
    expect(await request(2, true)).toBe(job); expect((await row(job)).attempts).toBe(2);
    await request(3, true); expect((await row(job)).attempts).toBe(3);
  });

  test("invalid dates, empty days, missing consent and deleting owners are rejected", async () => {
    await expect(request()).rejects.toThrow(/먼저/); await save();
    await expect(request(1, false, tomorrow)).rejects.toThrow(/요청 날짜/);
    await expect(db.query("select public.request_daily_connection(null,false,$1)", [id(1)])).rejects.toThrow(/요청 날짜/);
    await expect(db.query("select public.request_daily_connection($1,null,$2)", [yesterday, id(1)])).rejects.toThrow(/요청 날짜/);
    await expect(db.query("select public.request_daily_connection($1,false,null)", [yesterday])).rejects.toThrow(/요청 날짜/);
    await db.exec("update public.profiles set ai_consent_at=null"); await expect(request()).rejects.toThrow(/동의/);
    await owner(); await db.query("update public.profiles set ai_consent_at=now(),deleting_at=now() where id=$1", [alice]); await user();
    await expect(request()).rejects.toThrow(/동의/);
  });
});

describe("connection leases and phase continuation", () => {
  test("claim is unique and research-to-drawing continuation keeps the same attempt without raw input", async () => {
    const job = await newJob(); await worker();
    const results = await Promise.all(Array.from({ length: 5 }, () => db.query<Job>("select * from public.claim_daily_connection($1)", [job])));
    const claimed = results.flatMap(r => r.rows); expect(claimed).toHaveLength(1); expect(claimed[0].attempts).toBe(1);
    await db.query("update public.daily_connections set status='queued',stage='drawing',image_prompt='news illustration',claim_token=null,claimed_at=null,entry_snapshot='[]',artwork_summary=null,artwork_tags='{}' where id=$1", [job]);
    const next = (await claim(job))[0]; expect(next).toMatchObject({ stage: "drawing", attempts: 1, entry_snapshot: [], artwork_summary: null });
    expect(next.claim_token).not.toBe(claimed[0].claim_token);
    await request(2, true); expect((await row(job)).attempts).toBe(1);
  });

  test("stale leases consume at most three attempts and fence all earlier tokens", async () => {
    const job = await newJob(); const first = (await claim(job))[0]; await expire(job);
    const second = (await claim(job))[0]; expect(second.attempts).toBe(2); expect(second.claim_token).not.toBe(first.claim_token);
    await worker();
    expect((await db.query("update public.daily_connections set status='ready' where id=$1 and claim_token=$2 and status='processing' returning id", [job, first.claim_token])).rows).toHaveLength(0);
    await user(); await expire(job); expect((await claim(job))[0].attempts).toBe(3); await expire(job);
    expect(await claim(job)).toHaveLength(0);
    expect(await row(job)).toMatchObject({ status: "failed", attempts: 3, claimed_at: null, retry_after: null, entry_snapshot: [], artwork_summary: null, artwork_tags: [] });
    await expect(request(2)).rejects.toThrow(/3회/);
  });

  test.each([false, true])("manual and automatic stale recovery do not double-charge (manual first: %s)", async manualFirst => {
    const job = await newJob(); await claim(job); await expire(job); await owner();
    const manual = () => db.query("select public.request_daily_connection($1,false,$2)", [yesterday, id(2)]);
    const automatic = () => db.query("select * from public.claim_daily_connection($1)", [job]);
    await Promise.all(manualFirst ? [manual(), automatic()] : [automatic(), manual()]);
    expect((await row(job)).attempts).toBe(2);
  });

  test("completed, failed, cancelled and missing jobs cannot be claimed", async () => {
    const job = await newJob();
    for (const status of ["ready", "no_match", "failed", "cancelled"]) {
      await change(job, `status='${status}',retry_after=now()-interval '1 hour'`); expect(await claim(job)).toHaveLength(0);
    }
    expect(await claim(id(99))).toHaveLength(0);
  });
});

describe("connection privacy, consent withdrawal and deletion", () => {
  test("only the owner can read results and clients cannot write or invoke worker/helper RPCs", async () => {
    const job = await newJob(); expect((await db.query("select id from public.daily_connections")).rows).toEqual([{ id: job }]);
    await expect(db.exec("update public.daily_connections set attempts=1")).rejects.toThrow(/permission denied/);
    await expect(db.exec("delete from public.daily_connections")).rejects.toThrow(/permission denied/);
    await expect(db.exec("select * from public.deleted_connection_attempts")).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.claim_daily_connection($1)", [job])).rejects.toThrow(/permission denied/);
    await user(bob); expect((await db.query("select * from public.daily_connections")).rows).toHaveLength(0);
    await expect(request()).rejects.toThrow(/먼저/);
    await db.exec("reset role; set role anon");
    await expect(db.exec("select * from public.daily_connections")).rejects.toThrow(/permission denied/);
    await expect(request()).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.current_connection_input($1,$2)", [alice, yesterday])).rejects.toThrow(/permission denied/);
  });

  test("withdrawing consent cancels queued work and removes its private input without a lease", async () => {
    const job = await newJob(); await db.exec("update public.profiles set ai_consent_at=null");
    expect(await row(job)).toMatchObject({ status: "cancelled", claimed_at: null, entry_snapshot: [], artwork_summary: null, artwork_tags: [], input_fingerprint: null });
    expect(await claim(job)).toHaveLength(0);
    await db.exec("update public.profiles set ai_consent_at=now()"); await request(2);
    expect(await row(job)).toMatchObject({ status: "queued", attempts: 2 });
  });

  test("a cancelled active lease fences writes and temporarily guards last-entry and account deletion", async () => {
    const job = await newJob(); const first = (await claim(job))[0];
    await db.exec("update public.profiles set ai_consent_at=null");
    const cancelled = await row(job); expect(cancelled.status).toBe("cancelled"); expect(cancelled.claimed_at).toEqual(first.claimed_at);
    expect(cancelled.claim_token).not.toBe(first.claim_token);
    await expect(remove()).rejects.toThrow(/하루연결 작업/);
    await expect(db.exec("select public.begin_account_deletion()")).rejects.toThrow(/하루연결 작업/);
    await worker(); expect((await db.query("update public.daily_connections set status='ready' where id=$1 and claim_token=$2 and status='processing' returning id", [job, first.claim_token])).rows).toHaveLength(0);
    await db.query("update public.daily_connections set claimed_at=null where id=$1 and status='cancelled' and claimed_at=$2", [job, first.claimed_at]);
    await user(); await remove(); expect(await count("public.daily_connections")).toBe(0);
    await db.exec("select public.begin_account_deletion()");
  });

  test("an expired cancelled lease no longer blocks the owner", async () => {
    const job = await newJob(); await claim(job); await db.exec("update public.profiles set ai_consent_at=null");
    await expire(job); await remove(); expect(await count("public.daily_connections")).toBe(0);
  });

  test.each(["queued", "failed", "ready", "no_match"])("deleting the last fragment removes %s input/results and preserves attempts", async status => {
    const job = await newJob(); await change(job, `status='${status}',attempts=2`);
    await remove(); expect(await count("public.daily_connections")).toBe(0);
    await worker(); expect((await db.query("select attempts from public.deleted_connection_attempts")).rows).toEqual([{ attempts: 2 }]);
    await user(); await save(); const replacement = await request(2); expect(replacement).not.toBe(job); expect((await row(replacement)).attempts).toBe(3);
    await remove(); await save(); await expect(request(3)).rejects.toThrow(/3회/);
  });

  test("a late replay cannot regenerate a deleted connection from newly written fragments", async () => {
    await newJob(); await remove(); await save(50, "새로 작성한 조각");
    await expect(request(1)).rejects.toThrow(/이미 처리한 요청/);
    expect(await count("public.daily_connections")).toBe(0);
    expect((await row(await request(2))).attempts).toBe(2);
  });

  test("removing one of several fragments preserves the cached connection and its original fingerprint", async () => {
    const job = await newJob(); await save(51, "두 번째 조각"); await change(job, "status='ready'"); const previous = await row(job);
    await remove(); expect(await row(job)).toMatchObject({ id: previous.id, input_fingerprint: previous.input_fingerprint });
  });

  test("fresh processing blocks last-entry deletion but a stale lease does not", async () => {
    const job = await newJob(); await claim(job); await expect(remove()).rejects.toThrow(/하루연결 작업/);
    await expire(job); await remove(); expect(await count("public.daily_connections")).toBe(0);
  });

  test("account deletion cancels queued jobs, hides their rows, prevents later claims and cascades all private state", async () => {
    const job = await newJob(); await db.exec("select public.begin_account_deletion()");
    expect((await db.query("select * from public.daily_connections")).rows).toHaveLength(0);
    expect(await row(job)).toMatchObject({ status: "cancelled", entry_snapshot: [], input_fingerprint: null });
    expect(await claim(job)).toHaveLength(0);
    await owner(); await db.query("delete from auth.users where id=$1", [alice]);
    expect(await count("public.daily_connections")).toBe(0); expect(await count("public.deleted_connection_attempts")).toBe(0);
  });

  test("existing personal-artwork pending deletion protection remains intact", async () => {
    await save(); await db.query("select public.request_team_artwork($1,false,$2)", [yesterday, id(1)]);
    await expect(db.exec("select public.begin_account_deletion()")).rejects.toThrow(/대기 중인 그림/);
  });
});

describe("isolated connection dispatcher with inert cron/net/vault substitutes", () => {
  const tick = async () => { await owner(); return (await db.query<{ outcome: string }>("select harujogak_private.connection_worker_tick() as outcome")).rows[0].outcome; };
  const enable = async () => { await owner(); await db.exec("update harujogak_private.connection_worker_control set enabled=true"); };
  const secret = async () => { await owner(); await db.exec("insert into vault.secrets values('harujogak_worker_cron_secret'); insert into vault.decrypted_secrets values('harujogak_worker_cron_secret','test-only-placeholder-with-at-least-32-characters')"); };

  test("starts disabled and never edits the existing artwork worker control or job schedule", async () => {
    await newJob(); expect(await tick()).toBe("disabled");
    expect((await db.query("select last_request_id from harujogak_private.worker_control")).rows).toEqual([{ last_request_id: 999 }]);
    expect((await db.query("select jobname,schedule,command from cron.job")).rows).toEqual([{ jobname: "harujogak-connection-worker", schedule: "* * * * *", command: "select harujogak_private.connection_worker_tick();" }]);
    expect(await count("net.http_request_queue")).toBe(0);
  });

  test("dispatches one bounded request and waits for that HTTP request before sending another", async () => {
    await newJob(); await enable(); await secret(); expect(await tick()).toBe("queued_http"); expect(await tick()).toBe("pending_http");
    expect((await db.query("select url,body from net.http_request_queue")).rows).toEqual([{ url: "https://harujogak-hihellow18.vercel.app/api/connection-jobs", body: {} }]);
    expect((await db.query("select outcome from harujogak_private.connection_worker_dispatches")).rows).toEqual([{ outcome: "queued_http" }]);
  });

  test("missing and malformed secrets are classified without dispatch", async () => {
    await newJob(); await enable(); expect(await tick()).toBe("config_missing");
    await owner(); await db.exec("insert into vault.secrets values('harujogak_worker_cron_secret'); insert into vault.decrypted_secrets values('harujogak_worker_cron_secret','short')");
    expect(await tick()).toBe("config_invalid"); expect(await count("net.http_request_queue")).toBe(0);
  });

  test("failed jobs never auto-retry, active leases wait, and stale final attempts remain recoverable", async () => {
    const job = await newJob(); await claim(job); await enable(); await secret(); expect(await tick()).toBe("active_processing");
    await change(job, "status='failed',retry_after=now()-interval '1 hour'"); expect(await tick()).toBe("idle");
    await change(job, "status='processing',attempts=3,claimed_at=now()-interval '11 minutes'");
    expect(await tick()).toBe("queued_http"); expect(await claim(job)).toHaveLength(0); expect((await row(job)).status).toBe("failed");
  });

  test("dispatcher functions and history are unavailable to browser and service roles", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await owner(); await db.exec(`set role ${role}`);
      await expect(db.exec("select harujogak_private.connection_worker_tick()")).rejects.toThrow(/permission denied/);
      await expect(db.exec("select * from harujogak_private.connection_worker_control")).rejects.toThrow(/permission denied/);
    }
  });
});
