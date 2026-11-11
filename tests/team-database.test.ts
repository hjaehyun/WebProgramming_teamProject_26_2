import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { nextExhibitionDates } from "../src/lib/exhibition-selection";

const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const entryId = "00000000-0000-4000-8000-000000000011";
const requestId = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
let db: PGlite;
let today: string;

async function asUser(id = alice) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function asWorker() { await db.exec("reset role; set role service_role"); }
async function add(id = entryId, text = "산책하며 작은 꽃을 보았다.") {
  return db.query("select public.save_team_entry($1,$2,$3::date)", [id, text, today]);
}
async function request(n = 1, redraw = false) {
  const result = await db.query<{ id: string }>("select public.request_team_artwork($1::date,$2,$3) as id", [today, redraw, requestId(n)]);
  return result.rows[0].id;
}
async function claim(id: string) {
  await asWorker();
  return (await db.query<{ id: string; attempts: number; claim_token: string; art_style: string }>("select * from public.claim_artwork($1)", [id])).rows[0];
}
async function ready(id: string) {
  await asWorker();
  await db.query("update public.daily_artworks set status='ready',title='꽃',scene_summary='꽃을 본 하루',image_prompt='a flower',image_path=user_id::text||'/old.png' where id=$1", [id]);
}
async function makeReady() {
  await add(); const id = await request(); await claim(id); await ready(id); await asUser(); return id;
}
async function exhibition(dates: string[] | null, publish: boolean | null = null) {
  const result = await db.query<{ id: string }>("select public.save_team_exhibition($1::date[],$2) as id", [dates, publish]);
  return result.rows[0].id;
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
  await db.exec(await readFile("supabase/migrations/202611040001_initial.sql", "utf8"));
  await db.query("insert into auth.users values($1)", [alice]);
  await db.exec("update public.profiles set ai_consent_at=now(),nickname='기존 사용자'");
  await db.exec(await readFile("supabase/migrations/20261111104704_team_frontend_integration.sql", "utf8"));
  expect((await db.query<{ onboarded: boolean; nickname: string }>("select onboarded,nickname from public.profiles")).rows[0]).toEqual({ onboarded: true, nickname: "기존 사용자" });
  today = (await db.query<{ day: string }>("select ((now() at time zone 'Asia/Seoul')::date)::text as day")).rows[0].day;
}, 30000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade");
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.exec("update public.profiles set ai_consent_at=now(),onboarded=true");
  await asUser();
});
afterAll(async () => { await db?.close(); });

describe("team integration migration on actual PostgreSQL", () => {
  test("client entry ids are stable on retry; server timestamp and ownership stay authoritative", async () => {
    await add(); await add();
    const rows = (await db.query<{ id: string; user_id: string; content: string }>("select id,user_id,content from public.entries")).rows;
    expect(rows).toEqual([{ id: entryId, user_id: alice, content: "산책하며 작은 꽃을 보았다." }]);
    await expect(db.query("select public.save_team_entry($1,'future',current_date+2)", [requestId(80)])).rejects.toThrow(/오늘 날짜/);
    await asUser(bob);
    expect((await db.query("select * from public.entries")).rows).toHaveLength(0);
    await expect(add()).rejects.toThrow();
    expect((await db.query("select * from public.entries")).rows).toHaveLength(0);
  });

  test("editing works before close and cannot change another person's or a frozen entry", async () => {
    await add();
    await db.query("select public.edit_entry($1,$2)", [entryId, "수정한 기록"]);
    expect((await db.query<{ content: string }>("select content from public.entries")).rows[0].content).toBe("수정한 기록");
    await asUser(bob);
    await expect(db.query("select public.edit_entry($1,'other')", [entryId])).rejects.toThrow(/찾을 수/);
    await asUser(); await request();
    await expect(db.query("select public.edit_entry($1,'too late')", [entryId])).rejects.toThrow(/마감된/);
    await expect(db.query("select public.remove_entry($1)", [entryId])).rejects.toThrow(/마감된/);
  });

  test("redrawing has no direct write bypass and request replay does not create a new job", async () => {
    await add(); const id = await request();
    expect(await request()).toBe(id);
    expect((await db.query("select * from public.daily_artworks")).rows).toHaveLength(1);
    await expect(db.query("update public.daily_artworks set attempts=0 where id=$1", [id])).rejects.toThrow(/permission denied/);
    const first = await claim(id); expect(first.attempts).toBe(1);
    expect(await claim(id)).toBeUndefined();
    await ready(id); await asUser();
    expect(await request()).toBe(id);
    await asWorker(); expect(await claim(id)).toBeUndefined();
    await asUser(); await db.exec("update public.profiles set art_style='crayon'");
    await request(2, true);
    const queued = (await db.query<{ status: string; image_prompt: string | null; image_path: string }>("select status,image_prompt,image_path from public.daily_artworks")).rows[0];
    expect(queued).toEqual({ status: "queued", image_prompt: null, image_path: `${alice}/old.png` });
    const second = await claim(id); expect(second.attempts).toBe(2); expect(second.art_style).toBe("crayon");
    await ready(id); await asUser();
    expect(await request(2, true)).toBe(id);
    await request(3, true); expect((await claim(id)).attempts).toBe(3);
    await ready(id); await asUser();
    await expect(request(4, true)).rejects.toThrow(/3회/);
  });

  test("three-attempt cap also covers failed and recovered jobs", async () => {
    await add(); const id = await request(); const first = await claim(id);
    await db.query("update public.daily_artworks set claimed_at=now()-interval '11 minutes' where id=$1", [id]);
    const recovered = await claim(id);
    expect(recovered.attempts).toBe(2); expect(recovered.claim_token).not.toBe(first.claim_token);
    expect((await db.query("update public.daily_artworks set status='ready' where id=$1 and claim_token=$2 returning id", [id, first.claim_token])).rows).toHaveLength(0);
    await db.query("update public.daily_artworks set status='failed' where id=$1", [id]);
    await asUser(); await request(2); expect((await claim(id)).attempts).toBe(3);
    await db.query("update public.daily_artworks set claimed_at=now()-interval '11 minutes' where id=$1", [id]);
    expect(await claim(id)).toBeUndefined();
    expect((await db.query<{ status: string }>("select status from public.daily_artworks where id=$1", [id])).rows[0].status).toBe("failed");
    await asUser(); await expect(request(3)).rejects.toThrow(/3회/);
  });

  test("cross-user redraw and creation without consent are refused", async () => {
    const id = await makeReady();
    await asUser(bob); await expect(request(2, true)).rejects.toThrow(/찾을 수/);
    await expect(db.query("select public.retry_artwork($1)", [id])).rejects.toThrow();
    await add(requestId(50), "Bob's entry"); await db.exec("update public.profiles set ai_consent_at=null");
    await expect(request(3)).rejects.toThrow(/동의/);
  });

  test("exhibition selection is owned, ordered, duplicate-free and atomic on failure", async () => {
    const id = await makeReady(); const ex = await exhibition([today], true);
    expect((await db.query("select artwork_id,position from public.exhibition_items")).rows).toEqual([{ artwork_id: id, position: 0 }]);
    await expect(exhibition([today, today])).rejects.toThrow(/완성된 내 그림/);
    expect((await db.query("select artwork_id from public.exhibition_items")).rows).toEqual([{ artwork_id: id }]);
    expect(await exhibition(null, false)).toBe(ex);
    await asUser(bob);
    expect((await db.query("select * from public.exhibitions")).rows).toHaveLength(0);
    expect((await db.query("select * from public.exhibition_items")).rows).toHaveLength(0);
    await expect(exhibition([today], true)).rejects.toThrow(/완성된 내 그림/);
    await asUser(); await exhibition([], false);
    expect((await db.query("select * from public.exhibition_items")).rows).toHaveLength(0);
  });

  test("queued redraw cannot replace an existing exhibition selection", async () => {
    const id = await makeReady(); await exhibition([today], false); await request(2, true);
    await expect(exhibition([today], true)).rejects.toThrow(/완성된 내 그림/);
    expect((await db.query("select artwork_id from public.exhibition_items")).rows).toEqual([{ artwork_id: id }]);
    expect((await db.query<{ is_public: boolean }>("select is_public from public.exhibitions")).rows[0].is_public).toBe(false);
  });

  test("client removal can clear multiple unavailable selections without weakening ready validation", async () => {
    const first = await makeReady();
    await asWorker();
    const other = (await db.query<{ id: string; day: string }>("insert into public.daily_artworks(user_id,artwork_date,status,art_style,entry_snapshot,image_path) values($1::uuid,$2::date-1,'ready','watercolor','[]',$1::uuid::text||'/other.png'),($1::uuid,$2::date-2,'ready','watercolor','[]',$1::uuid::text||'/kept.png') returning id,artwork_date::text as day", [alice, today])).rows;
    const selected = [today, other[0].day, other[1].day];
    await asUser(); await exhibition(selected, true);
    await asWorker();
    await db.query("update public.daily_artworks set status='failed',attempts=3 where id=$1", [first]);
    await db.query("update public.daily_artworks set status='processing' where id=$1", [other[0].id]);
    await asUser();
    await expect(exhibition(selected.slice(1))).rejects.toThrow(/완성된 내 그림/);
    const dates = nextExhibitionDates(selected, {
      [today]: { status: "failed" }, [other[0].day]: { status: "processing" }, [other[1].day]: { status: "ready" },
    }, today);
    await exhibition(dates);
    expect((await db.query("select artwork_id,position from public.exhibition_items")).rows).toEqual([{ artwork_id: other[1].id, position: 0 }]);
    expect((await db.query<{ is_public: boolean }>("select is_public from public.exhibitions")).rows[0].is_public).toBe(true);
  });

  test("deletion refuses queued and processing jobs, and retrying cleanup stays possible", async () => {
    await add(); const id = await request();
    await expect(db.exec("select public.begin_account_deletion()")).rejects.toThrow(/대기 중/);
    await claim(id); await asUser();
    await expect(db.exec("select public.begin_account_deletion()")).rejects.toThrow(/대기 중/);
    await ready(id); await asUser();
    await db.exec("select public.begin_account_deletion(); select public.begin_account_deletion()");
    const p = (await db.query<{ deleting_at: Date | null; ai_consent_at: Date | null }>("select deleting_at,ai_consent_at from public.profiles")).rows[0];
    expect(p.deleting_at).not.toBeNull(); expect(p.ai_consent_at).toBeNull();
    await expect(add(requestId(60))).rejects.toThrow(/계정 상태/);
    await expect(request(2, true)).rejects.toThrow(/동의/);
    await expect(exhibition([], false)).rejects.toThrow(/계정 상태/);
    await expect(db.exec("select public.reserve_curation()")).rejects.toThrow(/동의/);
    // Direct public RPCs cannot resume generation by restoring consent.
    await db.exec("update public.profiles set ai_consent_at=now()");
    await expect(db.query("select public.retry_artwork($1)", [id])).rejects.toThrow();
    expect(await claim(id)).toBeUndefined();
  });

  test("legacy entry and close RPCs cannot bypass a pending deletion", async () => {
    await add(); await db.exec("select public.begin_account_deletion()");
    await db.exec("update public.profiles set ai_consent_at=now()");
    await expect(db.exec("select public.add_entry('legacy bypass')")).rejects.toThrow(/탈퇴 정리/);
    await expect(db.query("select public.edit_entry($1,'legacy edit')", [entryId])).rejects.toThrow(/탈퇴 정리/);
    await expect(db.query("select public.close_day($1::date)", [today])).rejects.toThrow(/탈퇴 정리/);
    expect((await db.query("select * from public.daily_artworks")).rows).toHaveLength(0);
  });

  test("worker excludes a deletion-marked owner even when consent and a queue row remain", async () => {
    await add(); const id = await request();
    // Simulate an interrupted administrative cleanup or a legacy queue race.
    await db.exec("reset role");
    await db.query("update public.profiles set deleting_at=now() where id=$1", [alice]);
    expect(await claim(id)).toBeUndefined();
    expect((await db.query<{ attempts: number }>("select attempts from public.daily_artworks where id=$1", [id])).rows[0].attempts).toBe(0);
  });

  test("a deleting owner cannot block automatic close or stale cleanup for other users", async () => {
    await db.exec("reset role");
    await db.query("insert into public.entries(user_id,content,entry_date) values($1,'Alice old entry',current_date-2),($2,'Bob old entry',current_date-2)", [alice, bob]);
    await db.query("insert into public.daily_artworks(user_id,artwork_date,status,art_style,entry_snapshot,attempts,claimed_at) values($1,current_date-3,'processing','watercolor','[]',3,now()-interval '11 minutes')", [alice]);
    await db.query("update public.profiles set deleting_at=now() where id=$1", [alice]);
    await asWorker();
    expect((await db.query<{ count: number }>("select public.enqueue_closed_days() as count")).rows[0].count).toBe(1);
    const job = (await db.query<{ user_id: string }>("select * from public.claim_artwork(null)")).rows[0];
    expect(job.user_id).toBe(bob);
    expect((await db.query("select * from public.daily_artworks where user_id=$1 and artwork_date=current_date-2", [alice])).rows).toHaveLength(0);
  });

  test("curator quota is per owner and day, atomic, and cannot be reset by client writes", async () => {
    for (let i = 0; i < 8; i++) await db.exec("select public.reserve_curation()");
    await expect(db.exec("select public.reserve_curation()")).rejects.toThrow(/8회/);
    expect((await db.query<{ calls: number }>("select calls from public.ai_daily_usage")).rows).toEqual([{ calls: 8 }]);
    await expect(db.exec("update public.ai_daily_usage set calls=0")).rejects.toThrow(/permission denied/);
    await asUser(bob); expect((await db.query("select * from public.ai_daily_usage")).rows).toHaveLength(0);
    await db.exec("select public.reserve_curation()");
    expect((await db.query<{ calls: number }>("select calls from public.ai_daily_usage")).rows).toEqual([{ calls: 1 }]);
    await db.exec("reset role; update public.ai_daily_usage set usage_date=usage_date-1");
    await asUser(); await db.exec("select public.reserve_curation()");
    expect((await db.query<{ calls: number }>("select calls from public.ai_daily_usage order by usage_date")).rows.map(r => r.calls)).toEqual([8, 1]);
  });

  test("anonymous callers cannot invoke new writes or read private tables", async () => {
    await db.exec("reset role; set role anon");
    await expect(db.exec("select public.reserve_curation()")).rejects.toThrow(/permission denied/);
    await expect(db.exec("select public.begin_account_deletion()")).rejects.toThrow(/permission denied/);
    await expect(db.exec("select public.save_team_exhibition(null,true)")).rejects.toThrow(/permission denied/);
    await expect(db.exec("select * from public.ai_daily_usage")).rejects.toThrow(/permission denied/);
    await expect(db.exec("select * from public.daily_artworks")).rejects.toThrow(/permission denied/);
  });
});
