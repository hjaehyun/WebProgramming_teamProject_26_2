import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
const mocks = vi.hoisted(() => ({ userClient: vi.fn(), adminClient: vi.fn(), statelessClient: vi.fn(), configured: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/server/core/supabase/server", () => mocks);
import { ensurePool, parseSongList, resetMusicState, songFeedbackPost, songPost, SONGS } from "../src/server/music";
import { moods } from "../src/server/core/domain";
import { artworkSongs } from "../src/server/data";

const alice = "00000000-0000-4000-8000-000000000001";
const date = "2026-11-15", origin = "http://127.0.0.1:3001", HOUR = 3600_000;
type Row = Record<string, any>;
const fetchMock = vi.fn<typeof fetch>();
const song = { id: 7, videoId: "0nROjv1QCn4", title: "아이유 - 밤편지", channel: "DooPiano" };
const listed = moods.flatMap(mood => SONGS[mood].map(s => ({ mood, ...s })));
let picked: Row;
let pool: Row[];
let nextId: number;
let linkError: unknown;
const rpc = vi.fn(async (name: string, _args?: Row) => ({ data: name === "pick_song" ? picked : null, error: null }));

/** Just enough of the query builder for song_pool (admin) and artwork_songs (reads). */
class Query {
  filters: Array<(r: Row) => boolean> = []; action: "select" | "upsert" | "delete" = "select"; rows: Row[] = [];
  constructor(public table: string) {}
  select(_fields: string) { return this; }
  in(k: string, v: unknown[]) { this.filters.push(r => v.includes(r[k])); return this; }
  maybeSingle() { return Promise.resolve({ data: [...pool].sort((a, b) => b.fetched_at.localeCompare(a.fetched_at))[0] ?? null, error: null }); }
  order() { return this; }
  limit() { return this; }
  range() { return this; }
  upsert(rows: Row[]) { this.action = "upsert"; this.rows = rows; return this; }
  delete() { this.action = "delete"; return this; }
  then(resolve: any, reject: any) { return Promise.resolve(this.run()).then(resolve, reject); }
  run() {
    if (this.table === "artwork_songs") return linkError ? { data: null, error: linkError } : { data: [{ artwork_id: "art-1", song: { id: 7, video_id: song.videoId, title: song.title, channel: song.channel } }], error: null };
    if (this.action === "upsert") {
      for (const row of this.rows) {
        const old = pool.find(r => r.mood === row.mood && r.video_id === row.video_id);
        if (old) Object.assign(old, row); else pool.push({ id: nextId++, ...row });
      }
      return { data: null, error: null };
    }
    const hit = pool.filter(r => this.filters.every(f => f(r)));
    if (this.action === "delete") { pool = pool.filter(r => !hit.includes(r)); return { data: null, error: null }; }
    return { data: hit, error: null };
  }
}
const admin = { from: (table: string) => new Query(table) };

const post = (payload: unknown = {}, from = origin) => songPost(new Request(`${origin}/api/me/artworks/${date}/song`, { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(payload) }), date);
const vote = (id: string, payload: unknown) => songFeedbackPost(new Request(`${origin}/api/me/songs/${id}/feedback`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload) }), id);
const calls = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)));
/** YouTube answering for every requested id except the missing ones; `status` overrides per id. */
function youtube(missing: string[] = [], status: Record<string, Row> = {}) {
  fetchMock.mockImplementation(async input => {
    const ids = new URL(String(input)).searchParams.get("id")!.split(",");
    return Response.json({ items: ids.filter(id => !missing.includes(id)).map(id => ({ id, status: { privacyStatus: "public", embeddable: true, ...status[id] } })) });
  });
}

beforeEach(() => {
  vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); resetMusicState();
  vi.stubEnv("APP_URL", origin); vi.stubEnv("YOUTUBE_API_KEY", "yt-secret-key"); vi.stubEnv("SUPABASE_SECRET_KEY", "service-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  picked = { song, unchanged: false, refill: null }; pool = []; nextId = 1; linkError = null;
  mocks.configured.mockReturnValue(true);
  mocks.adminClient.mockReturnValue(admin);
  mocks.userClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: alice } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: alice, onboarded: true, deleting_at: null }, error: null }) }) }) }),
    rpc,
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the hand-picked song list", () => {
  test("has 20 well-formed songs for each of the six moods, and bad lines are ignored", () => {
    expect(Object.keys(SONGS)).toEqual([...moods]);
    for (const mood of moods) expect(SONGS[mood]).toHaveLength(20);
    expect(new Set(listed.map(s => s.video_id)).size).toBe(120);
    expect(SONGS.calm[0]).toEqual({ video_id: "0nROjv1QCn4", title: "아이유 - 밤편지", channel: "DooPiano" });
    expect(parseSongList("aaaaaaaaaaa | 머리글 없음 | x\n[calm]\naaaaaaaaaaa | 곡 | 채널\naaaaaaaaaaa | 중복 | 채널\nshort | 곡 | 채널\nbbbbbbbbbbb |  | 채널\nccccccccccc | 곡 | 채널 | 더\n[angry]\nddddddddddd | 곡 | 채널\n[cozy]\neeeeeeeeeee | 채널 없음"))
      .toMatchObject({ calm: [{ video_id: "aaaaaaaaaaa", title: "곡", channel: "채널" }], cozy: [{ video_id: "eeeeeeeeeee", title: "채널 없음", channel: "" }], lively: [] });
  });
});

describe("songs through the API", () => {
  test("the first request checks the list with YouTube (ids only) and stores it; later requests don't call YouTube", async () => {
    youtube();
    const r = await post({ reroll: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ song, unchanged: false });
    expect(rpc.mock.calls).toEqual([["pick_song", { p_date: date, p_reroll: true }]]);
    expect(calls()).toHaveLength(3); // 120 ids, 50 per videos.list call = 3 quota units
    for (const url of calls()) {
      expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
      expect([...url.searchParams.keys()].sort()).toEqual(["id", "maxResults", "part"]);
      expect(url.href).not.toContain("yt-secret-key");
    }
    // The key goes in a header, and nothing but the three query fields above is sent.
    for (const [, init] of fetchMock.mock.calls) expect(init).toMatchObject({ headers: { "X-Goog-Api-Key": "yt-secret-key" }, redirect: "error" });
    expect(fetchMock.mock.calls.every(([, init]) => init?.body === undefined && (init?.method ?? "GET") === "GET")).toBe(true);
    expect(calls().flatMap(u => u.searchParams.get("id")!.split(",")).sort()).toEqual(listed.map(s => s.video_id).sort());
    expect(pool).toHaveLength(120);
    expect(pool[0]).toEqual({ id: 1, mood: "calm", video_id: "0nROjv1QCn4", title: "아이유 - 밤편지", channel: "DooPiano", fetched_at: expect.any(String) });
    expect((await post()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // A new server instance sees the stored check time and spends no quota.
    resetMusicState();
    expect((await post()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Due again a day later.
    resetMusicState();
    await ensurePool(new Date(Date.now() + 25 * HOUR));
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  test("videos YouTube no longer plays, and songs taken off the list, leave the pool", async () => {
    const [gone, hidden, blocked] = [listed[0].video_id, listed[1].video_id, listed[2].video_id];
    pool = [
      { id: 90, mood: "calm", video_id: gone, title: "예전 제목", channel: "x", fetched_at: "2026-10-01T00:00:00Z" },
      { id: 91, mood: "calm", video_id: "zzzzzzzzzzz", title: "목록에서 뺀 곡", channel: "x", fetched_at: "2026-11-14T00:00:00Z" },
      { id: 92, mood: "cozy", video_id: listed[3].video_id, title: "다른 분위기로 옮긴 곡", channel: "x", fetched_at: "2026-11-14T00:00:00Z" },
      { id: 93, mood: "calm", video_id: listed[3].video_id, title: "예전 제목", channel: "x", fetched_at: "2026-10-01T00:00:00Z" },
    ];
    nextId = 100;
    youtube([gone], { [hidden]: { privacyStatus: "private" }, [blocked]: { embeddable: false } });
    expect((await post()).status).toBe(200);
    expect(pool).toHaveLength(117);
    expect(pool.map(r => r.id).filter(id => id < 100)).toEqual([93]);
    const refreshed = pool.find(r => r.id === 93)!;
    expect(refreshed.title).toBe(listed[3].title);
    expect(Date.now() - Date.parse(refreshed.fetched_at)).toBeLessThan(HOUR);
    for (const id of [gone, hidden, blocked, "zzzzzzzzzzz"]) expect(pool.some(r => r.video_id === id)).toBe(false);
  });

  test("a YouTube failure still serves stored songs, is a retryable 503 only when none are usable, and is not hammered", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { errors: [{ reason: "quotaExceeded" }] } }, { status: 403 }));
    pool = [{ id: 1, mood: "calm", video_id: "0nROjv1QCn4", title: "아이유 - 밤편지", channel: "DooPiano", fetched_at: "2026-11-14T00:00:00Z" }];
    const served = await post();
    expect(served.status).toBe(200);
    expect(await served.json()).toEqual({ song, unchanged: false });
    picked = { song: null, unchanged: true, refill: "lonely" };
    const empty = await post();
    expect(empty.status).toBe(503);
    expect(JSON.stringify(await empty.json())).not.toMatch(/quota|lonely/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // one attempt (3 parallel calls), no retry on the second request
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("yt-secret-key");
    expect(pool).toHaveLength(1);
  });

  test("an answer missing most of the list is treated as a fault, not as those videos being gone", async () => {
    const stored = { id: 1, mood: "calm", video_id: "0nROjv1QCn4", title: "아이유 - 밤편지", channel: "DooPiano", fetched_at: "2026-11-14T00:00:00Z" };
    for (const missing of [listed.map(s => s.video_id), listed.slice(0, 61).map(s => s.video_id)]) {
      resetMusicState(); pool = [{ ...stored }];
      youtube(missing);
      await expect(ensurePool()).rejects.toThrow();
      expect(pool).toEqual([stored]);
    }
    expect((await post()).status).toBe(200);
  });

  test("no eligible songs is a successful empty recommendation, not a provider error", async () => {
    youtube();
    picked = { song: null, unchanged: true, refill: null };
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ song: null, unchanged: true });
  });

  test("off without a key, and the usual write guards apply", async () => {
    expect((await post({}, "https://another.invalid")).status).toBe(403);
    expect((await post({ reroll: "yes" })).status).toBe(400);
    expect((await songPost(new Request(`${origin}/x`, { method: "POST", headers: { Origin: origin }, body: "{}" }), "2026-02-30")).status).toBe(400);
    vi.stubEnv("YOUTUBE_API_KEY", "");
    expect((await post()).status).toBe(501);
    expect((await vote("7", { vote: 1 })).status).toBe(501);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("feedback accepts only a like or dislike for a numeric song id", async () => {
    const ok = await vote("7", { vote: 1 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("vote_song", { p_song: 7, p_vote: 1 });
    for (const [id, payload] of [["7", { vote: 5 }], ["7", {}], ["abc", { vote: 1 }], ["0", { vote: 1 }], ["7.5", { vote: -1 }]] as const) {
      expect((await vote(id, payload)).status).toBe(400);
    }
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reading songs never fails the page: before the migrations there are simply none", async () => {
    const none = { ok: false, songs: new Map() };
    expect(await artworkSongs(admin as any, ["art-1"])).toEqual({ ok: true, songs: new Map([["art-1", song]]) });
    expect(await artworkSongs(admin as any, "own")).toEqual({ ok: true, songs: new Map([["art-1", song]]) });
    // No ids means nothing may be read: an admin client must never fall through to "everything".
    expect(await artworkSongs(admin as any, [])).toEqual(none);
    linkError = { code: "PGRST205", message: "Could not find the table" };
    expect(await artworkSongs(admin as any, "own")).toEqual(none);
    linkError = null; vi.stubEnv("YOUTUBE_API_KEY", "");
    expect(await artworkSongs(admin as any, "own")).toEqual(none);
  });
});

describe("song migration on actual PostgreSQL", () => {
  const alice = "00000000-0000-4000-8000-000000000001";
  const bob = "00000000-0000-4000-8000-000000000002";
  type Pick = { song: { id: number; videoId: string; title: string; channel: string } | null; unchanged: boolean; refill: string | null };
  let db: PGlite;
  let today: string;

  async function asUser(id = alice) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  async function asWorker() { await db.exec("reset role; set role service_role"); }
  /** A finished picture for the user, inserted the way the worker leaves it. */
  async function picture({ user = alice, mood = "lonely" as string | null, scene = "day", status = "ready", day = today } = {}) {
    await asWorker();
    const id = (await db.query<{ id: string }>("insert into public.daily_artworks(user_id,artwork_date,status,art_style,entry_snapshot,scene,mood) values($1,$2::date,$3,'watercolor','[]',$4,$5) returning id", [user, day, status, scene, mood])).rows[0].id;
    await asUser(user);
    return id;
  }
  async function pool(mood: string, videoId: string, age = "0 days") {
    await asWorker();
    const id = (await db.query<{ id: number }>(`insert into public.song_pool(mood,video_id,title,channel,fetched_at) values($1,$2,$3,'채널',now()-interval '${age}') returning id`, [mood, videoId, `노래 ${videoId}`])).rows[0].id;
    await asUser();
    return Number(id);
  }
  const pick = async (reroll = false, day = today) => (await db.query<{ r: Pick }>("select public.pick_song($1::date,$2) as r", [day, reroll])).rows[0].r;
  const migration = (file: string) => readFile(`supabase/migrations/${file}.sql`, "utf8");
  const fallbackMigration = "20261115110029_songs_without_artwork_mood";

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
    const files = ["202611040001_initial", "20261111104704_team_frontend_integration", "20261112003000_entry_weather", "20261115090000_artwork_songs"];
    for (const file of files) await db.exec(await migration(file));
    // Running the song migration again (e.g. over an earlier draft of it) rebuilds only the song tables.
    await db.query("insert into auth.users values($1)", [alice]);
    const art = (await db.query<{ id: string }>("insert into public.daily_artworks(user_id,artwork_date,status,art_style,entry_snapshot,mood) values($1,current_date-9,'ready','watercolor','[]','calm') returning id", [alice])).rows[0].id;
    const old = (await db.query<{ id: number }>("insert into public.song_pool(mood,video_id,title) values('calm','aaaaaaaaaaa','예전 곡') returning id")).rows[0].id;
    await db.query("insert into public.artwork_songs values($1,$2)", [art, old]);
    await db.exec(await migration(files[3]));
    expect((await db.query("select * from public.song_pool")).rows).toHaveLength(0);
    expect((await db.query("select * from public.artwork_songs")).rows).toHaveLength(0);
    expect((await db.query("select id,mood from public.daily_artworks")).rows).toEqual([{ id: art, mood: "calm" }]);
    // Apply the additive follow-up after the historical table-rebuild migration.
    await db.exec(await migration(fallbackMigration));
    today = (await db.query<{ day: string }>("select ((now() at time zone 'Asia/Seoul')::date)::text as day")).rows[0].day;
  }, 30000);

  beforeEach(async () => {
    await db.exec("reset role; truncate auth.users cascade; truncate public.song_pool cascade");
    await db.query("insert into auth.users values($1),($2)", [alice, bob]);
    await db.exec("update public.profiles set ai_consent_at=now(),onboarded=true");
    await asUser();
  });
  afterAll(async () => { await db?.close(); });

  describe("picking and voting", () => {
    test("the follow-up migration preserves existing artwork, songs, links and feedback when applied twice", async () => {
      await picture({ mood: null });
      const songId = await pool("calm", "aaaaaaaaaaa");
      await pick();
      await db.query("select public.vote_song($1,1)", [songId]);
      await db.exec("reset role");
      const snapshot = async () => Promise.all([
        db.query("select to_jsonb(a) as row from public.daily_artworks a order by id"),
        db.query("select to_jsonb(s) as row from public.song_pool s order by id"),
        db.query("select to_jsonb(s) as row from public.artwork_songs s order by artwork_id"),
        db.query("select to_jsonb(f) as row from public.song_feedback f order by user_id,song_id"),
      ]).then(results => results.map(result => result.rows));
      const before = await snapshot();
      expect(before.map(rows => rows.length)).toEqual([1, 1, 1, 1]);
      for (let i = 0; i < 2; i++) {
        await db.exec(await migration(fallbackMigration));
        expect(await snapshot()).toEqual(before);
      }
    });

    test.each(["lonely", null])("an empty or month-old pool asks for a refill for mood %s", async mood => {
      const expectedMood = mood ?? "calm";
      await picture({ mood });
      expect(await pick()).toEqual({ song: null, unchanged: true, refill: expectedMood });
      await pool(expectedMood, "aaaaaaaaaaa", "31 days");
      await pool("cozy", "bbbbbbbbbbb");
      expect((await pick()).refill).toBe(expectedMood);
      expect((await db.query("select * from public.artwork_songs")).rows).toHaveLength(0);
    });

    test("old pictures without a mood use calm songs without changing or redrawing the artwork", async () => {
      const calm = await pool("calm", "aaaaaaaaaaa");
      for (const mood of ["cozy", "lively", "lonely", "flutter", "dreamy"]) await pool(mood, `${mood[0]}${mood[1]}ccccccccc`);
      const oldDay = (await db.query<{ day: string }>("select ($1::date-9)::text as day", [today])).rows[0].day;
      const art = await picture({ mood: null, day: oldDay });
      await asWorker();
      await db.query("update public.daily_artworks set image_path=$2,image_prompt='An existing park',scene_summary='이미 완성된 하루',title='기존 그림',attempts=2 where id=$1", [art, `${alice}/${art}/original.png`]);
      for (const scene of ["day", "park", "cafe", "cat", "rain", "night"]) {
        await asWorker(); await db.query("update public.daily_artworks set scene=$2 where id=$1", [art, scene]); await asUser();
        const before = (await db.query("select to_jsonb(a) as artwork from public.daily_artworks a where id=$1", [art])).rows;
        expect((await pick(false, oldDay)).song?.id).toBe(calm);
        expect((await pick(true, oldDay)).song?.id).toBe(calm);
        expect((await db.query("select to_jsonb(a) as artwork from public.daily_artworks a where id=$1", [art])).rows).toEqual(before);
      }
      expect((await db.query("select artwork_id,song_id from public.artwork_songs")).rows).toEqual([{ artwork_id: art, song_id: calm }]);
    });

    test("a known mood still chooses its own list, and losing it keeps an existing song until reroll", async () => {
      const dreamy = await pool("dreamy", "aaaaaaaaaaa");
      const calm = await pool("calm", "bbbbbbbbbbb");
      const art = await picture({ mood: "dreamy" });
      const picked = await pick();
      expect(picked.song?.id).toBe(dreamy);
      await asWorker(); await db.query("update public.daily_artworks set mood=null where id=$1", [art]); await asUser();
      expect(await pick()).toEqual({ ...picked, unchanged: true });
      expect((await pick(true)).song?.id).toBe(calm);
      await expect(db.query("update public.daily_artworks set mood='calm'")).rejects.toThrow(/permission denied/);
      await asWorker();
      await expect(db.query("update public.daily_artworks set mood='angry'")).rejects.toThrow(/check constraint/);
    });

    test.each(["lonely", null])("the first pick is kept and reroll chooses another song for mood %s", async mood => {
      const expectedMood = mood ?? "calm";
      const art = await picture({ mood });
      const first = await pool(expectedMood, "aaaaaaaaaaa");
      const picked = await pick();
      expect(picked).toEqual({ song: { id: first, videoId: "aaaaaaaaaaa", title: "노래 aaaaaaaaaaa", channel: "채널" }, unchanged: false, refill: null });
      expect(await pick()).toEqual({ ...picked, unchanged: true });
      // Nothing else in the pool: the reroll keeps the song.
      expect(await pick(true)).toEqual({ ...picked, unchanged: true });
      const second = await pool(expectedMood, "ccccccccccc");
      await pool("lively", "ddddddddddd");
      for (let i = 0; i < 4; i++) {
        const next = await pick(true);
        expect(next.unchanged).toBe(false);
        expect(next.song?.id).toBe(i % 2 === 0 ? second : first);
      }
      expect((await db.query("select artwork_id,song_id from public.artwork_songs")).rows).toEqual([{ artwork_id: art, song_id: expect.anything() }]);
    });

    test.each(["lonely", null])("disliked songs stay excluded and votes remain per user for mood %s", async mood => {
      const expectedMood = mood ?? "calm";
      await picture({ mood });
      const a = await pool(expectedMood, "aaaaaaaaaaa"), b = await pool(expectedMood, "bbbbbbbbbbb");
      await db.query("select public.vote_song($1,-1)", [a]);
      for (let i = 0; i < 5; i++) expect((await pick(true)).song?.id).toBe(b);
      await db.query("select public.vote_song($1,1)", [a]);
      expect((await db.query<{ vote: number }>("select vote from public.song_feedback")).rows).toEqual([{ vote: 1 }]);
      expect((await pick(true)).song?.id).toBe(a);
      await expect(db.query("select public.vote_song($1,2)", [a])).rejects.toThrow(/입력 내용/);
      await expect(db.query("select public.vote_song(999999,1)")).rejects.toThrow(/찾을 수/);
      await asUser(bob);
      expect((await db.query("select * from public.song_feedback")).rows).toHaveLength(0);
    });

    test.each(["lonely", null])("only the owner's finished picture can get a song for mood %s", async mood => {
      await pool(mood ?? "calm", "aaaaaaaaaaa");
      await expect(pick()).rejects.toThrow(/완성된 그림/);
      const art = await picture({ status: "processing", mood });
      await expect(pick()).rejects.toThrow(/완성된 그림/);
      await asWorker(); await db.query("update public.daily_artworks set status='ready' where id=$1", [art]);
      await asUser(bob);
      await expect(pick()).rejects.toThrow(/완성된 그림/);
      expect((await db.query("select * from public.artwork_songs")).rows).toHaveLength(0);
    });

    test.each(["lonely", null])("write restrictions, private links and deletion guards remain for mood %s", async mood => {
      const art = await picture({ mood });
      const song = await pool(mood ?? "calm", "aaaaaaaaaaa");
      await pick();
      await expect(db.query("insert into public.song_pool(mood,video_id,title) values('calm','zzzzzzzzzzz','x')")).rejects.toThrow(/permission denied/);
      await expect(db.query("update public.artwork_songs set song_id=$1", [song])).rejects.toThrow(/permission denied/);
      await expect(db.query("insert into public.song_feedback values($1,$2,1)", [alice, song])).rejects.toThrow(/permission denied/);
      expect((await db.query("select * from public.artwork_songs")).rows).toEqual([{ artwork_id: art, song_id: expect.anything() }]);
      await asUser(bob);
      expect((await db.query("select * from public.artwork_songs")).rows).toHaveLength(0);
      expect((await db.query("select * from public.song_pool")).rows).toHaveLength(1);
      await db.exec("reset role; set role anon");
      await expect(db.exec("select * from public.song_pool")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.pick_song($1::date,false)", [today])).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
      await db.query("update public.profiles set deleting_at=now() where id=$1", [alice]);
      await asUser();
      await expect(pick(true)).rejects.toThrow(/계정 상태/);
      await expect(db.query("select public.vote_song($1,1)", [song])).rejects.toThrow(/계정 상태/);
    });

    test("the same video may sit in two moods, and removing a pool row, picture or account removes its links", async () => {
      const art = await picture();
      const song = await pool("lonely", "aaaaaaaaaaa");
      await pool("calm", "aaaaaaaaaaa");
      await asWorker();
      await expect(db.query("insert into public.song_pool(mood,video_id,title) values('calm','aaaaaaaaaaa','중복')")).rejects.toThrow(/song_pool_mood_video/);
      await asUser();
      await pick(); await db.query("select public.vote_song($1,1)", [song]);
      await asWorker();
      await db.query("delete from public.song_pool where id=$1", [song]);
      expect((await db.query("select * from public.artwork_songs")).rows).toHaveLength(0);
      expect((await db.query("select * from public.song_feedback")).rows).toHaveLength(0);
      expect((await db.query("select id from public.daily_artworks")).rows).toEqual([{ id: art }]);
      await pool("lonely", "bbbbbbbbbbb"); await pick();
      await db.exec("reset role"); await db.query("delete from auth.users where id=$1", [alice]);
      expect((await db.query("select * from public.artwork_songs")).rows).toHaveLength(0);
      expect((await db.query("select * from public.song_pool")).rows).toHaveLength(2);
    });
  });
});
