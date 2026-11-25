import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// The finished-day and past-day-draft migrations on PostgreSQL in PGlite. Its single connection
// serializes overlapping calls; these tests check both observable orders, not multi-session locks.
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const entryId = "00000000-0000-4000-8000-000000000011";
const id = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, "0")}`;
let db: PGlite;
let today: string, yesterday: string, twoDaysAgo: string, tomorrow: string;

async function asUser(user = alice) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
}
async function asWorker() { await db.exec("reset role; set role service_role"); }
async function asOwner() { await db.exec("reset role"); }
const save = (entry: string, text: string, day = today) => db.query("select public.save_team_entry($1,$2,$3::date)", [entry, text, day]);
const edit = (entry: string, text: string) => db.query("select public.edit_entry($1,$2)", [entry, text]);
async function remove(entry: string) {
  return (await db.query<{ art: string | null }>("select public.remove_team_entry($1) as art", [entry])).rows[0].art;
}
async function request(n: number, redraw = false, day = today) {
  return (await db.query<{ id: string }>("select public.request_team_artwork($1::date,$2,$3) as id", [day, redraw, id(n)])).rows[0].id;
}
async function claim(art: string) {
  await asWorker();
  const row = (await db.query<{ attempts: number }>("select * from public.claim_artwork($1)", [art])).rows[0];
  await asUser();
  return row;
}
async function finish(art: string, status = "ready") {
  await asWorker();
  await db.query("update public.daily_artworks set status=$2,title='꽃',scene_summary='꽃을 본 하루',image_prompt='a flower',image_path=user_id::text||'/'||id::text||'/a.png' where id=$1", [art, status]);
  await asUser();
}
/** Today's picture, finished, drawn from one fragment. */
async function readyToday() {
  await save(entryId, "산책하며 작은 꽃을 보았다.");
  const art = await request(1); await claim(art); await finish(art); return art;
}
/** A past day closed by the automatic worker, with its fragments written on that day. */
async function closedPast(day: string, texts = ["지난 기록"]) {
  await asOwner();
  for (const [i, text] of texts.entries()) {
    await db.query("insert into public.entries(id,user_id,content,entry_date,created_at) values($1,$2,$3,$4::date,$4::date + interval '3 hours')", [id(50 + i), alice, text, day]);
  }
  await asWorker();
  const art = (await db.query<{ id: string }>("select public.close_day_for($1,$2::date) as id", [alice, day])).rows[0].id;
  await asUser();
  return art;
}
async function row(art: string) {
  await asOwner();
  const r = (await db.query<{ status: string; attempts: number; image_prompt: string | null; error_message: string | null; snapshot: string[] | null }>(
    "select status,attempts,image_prompt,error_message,(select array_agg(e->>'content' order by e->>'content') from jsonb_array_elements(entry_snapshot) e) as snapshot from public.daily_artworks where id=$1", [art])).rows[0];
  await asUser();
  return r;
}
async function count(sql: string) {
  await asOwner();
  const n = (await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0].n;
  await asUser();
  return n;
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
  for (const file of ["202611040001_initial", "20261111104704_team_frontend_integration", "20261115090000_artwork_songs", "20261120064000_edit_finished_days", "20261125111300_past_day_drafts"]) {
    await db.exec(await readFile(`supabase/migrations/${file}.sql`, "utf8"));
  }
  const days = (await db.query<Record<string, string>>(`select d::text as today,(d-1)::text as yesterday,(d-2)::text as two,(d+1)::text as tomorrow from (select (now() at time zone 'Asia/Seoul')::date d) s`)).rows[0];
  ({ today, yesterday, two: twoDaysAgo, tomorrow } = days);
}, 30000);

beforeEach(async () => {
  await db.exec("reset role; truncate auth.users cascade; truncate public.song_pool cascade");
  await db.query("insert into auth.users values($1),($2)", [alice, bob]);
  await db.exec("update public.profiles set ai_consent_at=now(),onboarded=true");
  await asUser();
});
afterAll(async () => { await db?.close(); });

describe("fragments of a day that already has a picture", () => {
  test("can be added, edited and removed; the picture keeps its snapshot until a redraw re-reads them", async () => {
    const art = await readyToday();
    await save(id(1), "저녁에 비가 왔다.");
    await save(id(1), "retry with the same id is not a second fragment");
    await edit(entryId, "산책하며 노란 꽃을 보았다.");
    await save(id(2), "지울 기록"); expect(await remove(id(2))).toBeNull();
    expect(await count("public.entries")).toBe(2);
    expect((await row(art)).snapshot).toEqual(["산책하며 작은 꽃을 보았다."]);

    await request(2, true);
    expect(await row(art)).toMatchObject({ status: "queued", image_prompt: null, snapshot: ["산책하며 노란 꽃을 보았다.", "저녁에 비가 왔다."] });
  });

  test("a past day takes fragments with or without a picture, but never while a picture is being drawn", async () => {
    const art = await closedPast(yesterday);
    await expect(save(id(1), "더한 기록", yesterday)).rejects.toThrow(/그리는 중/);
    await expect(edit(id(50), "고친 기록")).rejects.toThrow(/그리는 중/);
    await expect(remove(id(50))).rejects.toThrow(/그리는 중/);
    await claim(art);
    await expect(save(id(1), "더한 기록", yesterday)).rejects.toThrow(/그리는 중/);
    await finish(art, "failed");
    await save(id(1), "더한 기록", yesterday);
    await edit(id(50), "고친 기록");
    await asOwner();
    // The added fragment belongs to yesterday but keeps the server time it was written at.
    const added = (await db.query<{ entry_date: string; written: string }>("select entry_date::text,((created_at at time zone 'Asia/Seoul')::date)::text as written from public.entries where id=$1", [id(1)])).rows[0];
    expect(added).toEqual({ entry_date: yesterday, written: today });
    await asUser();

    await save(id(2), "그림 없는 날", twoDaysAgo);
    await expect(save(id(3), "내일", tomorrow)).rejects.toThrow(/오늘이나 지난 날/);
    // Today without a picture works as before.
    await save(id(4), "오늘 기록");
  });

  test("today's picture also blocks changes while queued", async () => {
    await save(entryId, "산책");
    const art = await request(1);
    await expect(save(id(1), "더", today)).rejects.toThrow(/그리는 중/);
    await expect(edit(entryId, "고침")).rejects.toThrow(/그리는 중/);
    await claim(art); await finish(art);
    await edit(entryId, "고침");
  });

  test("another user can neither change nor remove the fragments", async () => {
    await readyToday();
    await asUser(bob);
    await expect(edit(entryId, "남의 글")).rejects.toThrow(/찾을 수/);
    await expect(remove(entryId)).rejects.toThrow(/찾을 수/);
    await save(id(1), "내 지난 날", yesterday);
    expect(await count("public.entries where user_id='" + bob + "'")).toBe(1);
    await asUser();
    expect(await count("public.daily_artworks")).toBe(1);
  });

  test("the 30-fragment limit still holds", async () => {
    await readyToday();
    for (let i = 1; i < 30; i++) await save(id(i), `기록 ${i}`);
    await expect(save(id(30), "서른한 번째")).rejects.toThrow(/30개/);
  });
});

describe("removing the last fragment", () => {
  test("removes the picture with its exhibition item and song, but not the exhibition", async () => {
    const art = await readyToday();
    await db.query("select public.save_team_exhibition($1::date[],true)", [[today]]);
    await asOwner();
    const song = (await db.query<{ id: number }>("insert into public.song_pool(mood,video_id,title) values('calm','aaaaaaaaaaa','곡') returning id")).rows[0].id;
    await db.query("insert into public.artwork_songs values($1,$2)", [art, song]);
    await asUser();

    expect(await remove(entryId)).toBe(art);
    expect(await count("public.daily_artworks")).toBe(0);
    expect(await count("public.exhibition_items")).toBe(0);
    expect(await count("public.artwork_songs")).toBe(0);
    expect(await count("public.exhibitions")).toBe(1);
    expect(await count("public.song_pool")).toBe(1);
  });

  test("a rewritten day continues from the attempts already used", async () => {
    const first = await readyToday();
    expect(await remove(entryId)).toBe(first);
    await save(id(1), "다시 쓴 기록");
    const second = await request(2);
    expect(second).not.toBe(first);
    expect((await claim(second)).attempts).toBe(2);
    await finish(second);
    expect(await remove(id(1))).toBe(second);

    // Every attempt used: the day closes as failed, and nothing can claim it.
    await asOwner(); await db.query("update public.deleted_artwork_attempts set attempts=3"); await asUser();
    await save(id(2), "또 쓴 기록");
    const third = await request(3);
    expect(await row(third)).toMatchObject({ status: "failed", attempts: 3, error_message: "이날 그림은 3회를 모두 그렸어요." });
    expect(await claim(third)).toBeUndefined();
    await expect(request(4, true)).rejects.toThrow(/3회/);
  });

  test("the automatic close skips no one when a day has no attempts left", async () => {
    await asOwner();
    await db.query("insert into public.deleted_artwork_attempts values($1,$2::date,3)", [alice, yesterday]);
    await db.query("insert into public.entries(user_id,content,entry_date,created_at) values($1,'앨리스',$3::date,$3::date::timestamp at time zone 'Asia/Seoul'),($2,'밥',$3::date,$3::date::timestamp at time zone 'Asia/Seoul')", [alice, bob, yesterday]);
    await asWorker();
    expect((await db.query<{ n: number }>("select public.enqueue_closed_days() as n")).rows[0].n).toBe(2);
    const rows = (await db.query<{ user_id: string; status: string; attempts: number }>("select user_id,status,attempts from public.daily_artworks order by user_id")).rows;
    expect(rows).toEqual([{ user_id: alice, status: "failed", attempts: 3 }, { user_id: bob, status: "queued", attempts: 0 }]);
  });

  test("the bookkeeping table and the new function are closed to direct client access", async () => {
    await readyToday();
    await expect(db.query("select * from public.deleted_artwork_attempts")).rejects.toThrow(/permission denied/);
    await asUser(bob);
    await expect(db.query("insert into public.deleted_artwork_attempts values($1,$2::date,0)", [bob, today])).rejects.toThrow(/permission denied/);
    await db.exec("reset role; set role anon");
    await expect(remove(entryId)).rejects.toThrow(/permission denied/);
  });
});

describe("retrying a failed picture", () => {
  test("resumes from its saved prompt when the fragments are unchanged, and is summarized again when they changed", async () => {
    await save(entryId, "산책");
    const art = await request(1); await claim(art); await finish(art, "failed");
    await request(2);
    expect(await row(art)).toMatchObject({ status: "queued", image_prompt: "a flower" });
    await claim(art); await finish(art, "failed");
    await edit(entryId, "비 오는 산책");
    await request(3);
    expect(await row(art)).toMatchObject({ status: "queued", image_prompt: null, snapshot: ["비 오는 산책"] });
  });
});

describe("past drafts without pictures", () => {
  test("can add, edit and delete fragments while retaining their real server write time", async () => {
    await save(entryId, "  뒤늦은 기록  ", yesterday);
    await save(id(1), "지울 기록", yesterday);
    await edit(entryId, "  고친 기록  ");
    expect(await remove(id(1))).toBeNull();
    const entries = (await db.query<{ content: string; day: string; written: string }>(
      "select content,entry_date::text as day,((created_at at time zone 'Asia/Seoul')::date)::text as written from public.entries")).rows;
    expect(entries).toEqual([{ content: "고친 기록", day: yesterday, written: today }]);
    expect(await count("public.daily_artworks")).toBe(0);
    expect(await remove(entryId)).toBeNull();
    expect(await count("public.entries")).toBe(0);
    expect(await count("public.deleted_artwork_attempts")).toBe(0);
  });

  test("overlapping duplicate saves are idempotent and cannot replace a fragment's text or date", async () => {
    await Promise.all([save(entryId, "첫 기록", yesterday), save(entryId, "중복 요청", yesterday)]);
    await save(entryId, "다른 날짜로 이동 시도", twoDaysAgo);
    const entries = (await db.query<{ content: string; day: string }>("select content,entry_date::text as day from public.entries")).rows;
    expect(entries).toEqual([{ content: "첫 기록", day: yesterday }]);
  });

  test("an explicit first generation freezes current fragments and remains idempotent", async () => {
    await save(entryId, "처음 쓴 과거 기록", yesterday);
    await save(id(1), "지울 조각", yesterday);
    await edit(entryId, "그릴 과거 기록"); await remove(id(1));
    const [first, second] = await Promise.all([request(1, false, yesterday), request(2, false, yesterday)]);
    expect(first).toBe(second);
    expect(await row(first)).toMatchObject({ status: "queued", attempts: 0, snapshot: ["그릴 과거 기록"] });
    expect(await count("public.daily_artworks")).toBe(1);
    await expect(edit(entryId, "생성 중 변경")).rejects.toThrow(/그리는 중/);
    await expect(remove(entryId)).rejects.toThrow(/그리는 중/);
    await expect(save(id(2), "생성 중 추가", yesterday)).rejects.toThrow(/그리는 중/);
    expect((await claim(first)).attempts).toBe(1);
    await finish(first);
    expect(await request(3, false, yesterday)).toBe(first);
    expect((await row(first)).attempts).toBe(1);
  });

  test("a removed last draft cannot be closed and an empty past day cannot be redrawn", async () => {
    await save(entryId, "삭제할 기록", yesterday); await remove(entryId);
    await expect(request(1, false, yesterday)).rejects.toThrow(/조각글/);
    await expect(request(2, true, yesterday)).rejects.toThrow(/그림을 찾을 수/);
    expect(await count("public.daily_artworks")).toBe(0);
  });

  test("future and null dates are rejected at the database boundary", async () => {
    await expect(save(entryId, "미래", tomorrow)).rejects.toThrow(/오늘이나 지난 날/);
    await expect(db.query("select public.save_team_entry($1,'날짜 없음',null)", [entryId])).rejects.toThrow(/오늘이나 지난 날/);
    await expect(request(1, false, tomorrow)).rejects.toThrow(/미래/);
    await expect(db.query("select public.request_team_artwork(null,false,$1)", [id(2)])).rejects.toThrow(/조각글/);
    // Even an out-of-band future row must not become editable through these RPCs.
    await asOwner();
    await db.query("insert into public.entries(id,user_id,content,entry_date) values($1,$2,'미래',$3::date)", [entryId, alice, tomorrow]);
    await asUser();
    await expect(edit(entryId, "변경")).rejects.toThrow(/오늘이나 지난 날/);
    await expect(remove(entryId)).rejects.toThrow(/오늘이나 지난 날/);
  });

  test("the 30-fragment limit and 1–500 character validation also apply to past drafts", async () => {
    await expect(save(entryId, " ", yesterday)).rejects.toThrow(/1~500/);
    await expect(save(entryId, "가".repeat(501), yesterday)).rejects.toThrow(/1~500/);
    await save(entryId, "가".repeat(500), yesterday);
    await expect(edit(entryId, " ")).rejects.toThrow(/1~500/);
    for (let i = 1; i < 29; i++) await save(id(i), `과거 ${i}`, yesterday);
    const results = await Promise.allSettled([save(id(29), "서른 번째", yesterday), save(id(30), "서른한 번째", yesterday)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await count("public.entries")).toBe(30);
  });

  test("draft editing needs no AI consent, but first drawing still requires it", async () => {
    await db.exec("update public.profiles set ai_consent_at=null");
    await save(entryId, "AI 동의 없는 과거 기록", yesterday);
    await edit(entryId, "고친 과거 기록");
    await expect(request(1, false, yesterday)).rejects.toThrow(/동의/);
    await save(id(1), "삭제할 조각", yesterday); expect(await remove(id(1))).toBeNull();
    await db.exec("update public.profiles set ai_consent_at=now()");
    expect(await row(await request(2, false, yesterday))).toMatchObject({ status: "queued", snapshot: ["고친 과거 기록"] });
  });

  test("account deletion blocks every draft mutation and first generation", async () => {
    await save(entryId, "과거 기록", yesterday);
    await asOwner(); await db.query("update public.profiles set deleting_at=now() where id=$1", [alice]); await asUser();
    await expect(save(id(1), "추가", yesterday)).rejects.toThrow(/계정 상태/);
    await expect(edit(entryId, "수정")).rejects.toThrow(/계정 상태/);
    await expect(remove(entryId)).rejects.toThrow(/계정 상태/);
    await expect(request(1, false, yesterday)).rejects.toThrow(/동의/);
    expect(await count("public.entries")).toBe(1);
  });

  test("anonymous callers and direct client writes remain blocked", async () => {
    await save(entryId, "내 과거 기록", yesterday);
    await expect(db.query("insert into public.entries(user_id,content,entry_date) values($1,'직접 작성',$2::date)", [alice, yesterday])).rejects.toThrow(/permission denied/);
    await expect(db.query("update public.entries set content='직접 변경'")).rejects.toThrow(/permission denied/);
    await expect(db.query("delete from public.entries")).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.enqueue_closed_days()")).rejects.toThrow(/permission denied/);
    await asUser(bob);
    await expect(edit(entryId, "남의 과거 글")).rejects.toThrow(/찾을 수/);
    await expect(remove(entryId)).rejects.toThrow(/찾을 수/);
    await expect(request(1, false, yesterday)).rejects.toThrow(/조각글/);
    expect((await db.query("select * from public.entries")).rows).toHaveLength(0);
    await db.exec("reset role; set role anon");
    await expect(save(id(1), "익명 작성", yesterday)).rejects.toThrow(/permission denied/);
    await expect(edit(entryId, "익명 변경")).rejects.toThrow(/permission denied/);
    await expect(remove(entryId)).rejects.toThrow(/permission denied/);
    await expect(request(1, false, yesterday)).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.enqueue_closed_days()")).rejects.toThrow(/permission denied/);
  });

  test("deleting and rewriting a past picture retains its total three-attempt limit", async () => {
    await save(entryId, "첫 과거 기록", yesterday);
    const first = await request(1, false, yesterday); await claim(first); await finish(first);
    await request(2, true, yesterday); await claim(first); await finish(first);
    expect(await remove(entryId)).toBe(first);
    await save(id(1), "다시 쓴 과거 기록", yesterday);
    const second = await request(3, false, yesterday); expect(second).not.toBe(first);
    expect((await claim(second)).attempts).toBe(3); await finish(second);
    await remove(id(1)); await save(id(2), "세 번째 과거 기록", yesterday);
    const third = await request(4, false, yesterday);
    expect(await row(third)).toMatchObject({ status: "failed", attempts: 3 });
    expect(await claim(third)).toBeUndefined();
    await expect(request(5, true, yesterday)).rejects.toThrow(/3회/);
  });
});

describe("automatic close keeps on-day writing separate from backfilled drafts", () => {
  const tick = async () => {
    await asWorker();
    const n = (await db.query<{ n: number }>("select public.enqueue_closed_days() as n")).rows[0].n;
    await asUser(); return n;
  };
  const original = async (entry: string, day: string, writtenAt?: string) => {
    await asOwner();
    await db.query("insert into public.entries(id,user_id,content,entry_date,created_at) values($1,$2,'그날 남긴 기록',$3::date,coalesce($4::timestamptz,$3::date::timestamp at time zone 'Asia/Seoul'))", [entry, alice, day, writtenAt ?? null]);
    await asUser();
  };

  test("new past drafts are never auto-enqueued, even after multiple ticks", async () => {
    await save(entryId, "어제 회상", yesterday); await save(id(1), "이틀 전 회상", twoDaysAgo);
    expect(await tick()).toBe(0); expect(await tick()).toBe(0);
    await edit(entryId, "자동 마감 없이 이어 쓰기");
    expect(await count("public.daily_artworks")).toBe(0);
    expect(await row(await request(1, false, yesterday))).toMatchObject({ status: "queued" });
  });

  test("original on-day writing still closes once, including late fragments in its snapshot", async () => {
    await original(entryId, yesterday);
    await save(id(1), "뒤늦게 더한 조각", yesterday);
    await save(id(2), "오늘은 아직 열려 있음");
    expect(await tick()).toBe(1); expect(await tick()).toBe(0);
    const art = (await db.query<{ id: string }>("select id from public.daily_artworks")).rows[0].id;
    expect(await row(art)).toMatchObject({ status: "queued", snapshot: ["그날 남긴 기록", "뒤늦게 더한 조각"] });
  });

  test("the original-write evidence uses the Korean date on both sides of midnight", async () => {
    await original(entryId, yesterday, `${yesterday}T14:59:59Z`); // 23:59:59 KST on the original day.
    await original(id(1), twoDaysAgo, `${twoDaysAgo}T15:00:00Z`); // 00:00 KST on the following day.
    expect(await tick()).toBe(1);
    const days = (await db.query<{ day: string }>("select artwork_date::text as day from public.daily_artworks")).rows;
    expect(days).toEqual([{ day: yesterday }]);
  });

  test("removing the only on-day fragment leaves the remaining backfilled draft manual", async () => {
    await original(entryId, yesterday); await save(id(1), "나중에 작성한 글", yesterday);
    expect(await remove(entryId)).toBeNull();
    expect(await tick()).toBe(0);
    expect(await row(await request(1, false, yesterday))).toMatchObject({ status: "queued", snapshot: ["나중에 작성한 글"] });
  });

  test("no-consent and deleting owners are still excluded from automatic close", async () => {
    await original(entryId, yesterday);
    await db.exec("update public.profiles set ai_consent_at=null"); expect(await tick()).toBe(0);
    await asOwner(); await db.query("update public.profiles set ai_consent_at=now(),deleting_at=now() where id=$1", [alice]); await asUser();
    expect(await tick()).toBe(0); expect(await count("public.daily_artworks")).toBe(0);
  });

  test("a candidate whose last fragment disappeared is rechecked instead of aborting the shared tick", async () => {
    await original(entryId, yesterday); await original(id(1), twoDaysAgo);
    await asOwner();
    // Deterministically make a later candidate stale after the loop opens its query. This exercises
    // the recheck without claiming that PGlite can simulate independent PostgreSQL connections.
    await db.exec(`alter function public.close_day_for(uuid,date) rename to close_day_for_original;
      create function public.close_day_for(p_user uuid,p_date date) returns uuid language plpgsql security definer set search_path='' as $$
      declare v_id uuid;
      begin
        v_id := public.close_day_for_original(p_user,p_date);
        delete from public.entries where user_id=p_user and entry_date<>p_date;
        return v_id;
      end; $$;
      revoke all on function public.close_day_for(uuid,date) from public,anon,authenticated;
      grant execute on function public.close_day_for(uuid,date) to service_role;`);
    try {
      expect(await tick()).toBe(1);
      expect(await count("public.daily_artworks")).toBe(1);
    } finally {
      await asOwner(); await db.exec("drop function public.close_day_for(uuid,date); alter function public.close_day_for_original(uuid,date) rename to close_day_for");
    }
  });
});
