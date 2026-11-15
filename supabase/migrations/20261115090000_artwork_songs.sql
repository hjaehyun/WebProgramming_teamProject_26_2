begin;
-- Additive: one YouTube song per finished picture, chosen by the picture's mood.
--
-- This single file replaces three drafts that were never committed (artwork_songs, song_moods,
-- song_requires_mood). It is safe to run whether or not any of those drafts was applied: the three
-- song tables are rebuilt from scratch (they hold no journal data; the pool refills itself from the
-- song list and pictures simply ask for a song again), and nothing else is dropped.
drop table if exists public.song_feedback, public.artwork_songs, public.song_pool cascade;

-- The atmosphere the AI chose while summarizing the day. NULL (no clear mood, or drawn before moods
-- existed) means the picture gets no song recommendation; the scene is not used as a stand-in.
alter table public.daily_artworks add column if not exists mood text
  check (mood in ('calm','cozy','lively','lonely','flutter','dreamy'));

-- song_pool is shared by everyone: the hand-picked list in src/server/song-list.ts, minus videos
-- YouTube can no longer play. It holds no journal text, summary, tag or user id. Only the API server
-- (service_role) writes it; rows not re-checked against YouTube for 30 days are not recommended.
create table public.song_pool (
  id bigint generated always as identity primary key,
  mood text not null check (mood in ('calm','cozy','lively','lonely','flutter','dreamy')),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(title) between 1 and 200),
  channel text not null default '' check (char_length(channel) <= 200),
  fetched_at timestamptz not null default now(),
  constraint song_pool_mood_video unique(mood, video_id)
);
create index song_pool_checked on public.song_pool(fetched_at);

-- A separate table (not a daily_artworks column) so existing artwork queries keep working
-- whether or not this migration has been applied.
create table public.artwork_songs (
  artwork_id uuid primary key references public.daily_artworks(id) on delete cascade,
  song_id bigint not null references public.song_pool(id) on delete cascade
);
create index artwork_songs_song on public.artwork_songs(song_id);

create table public.song_feedback (
  user_id uuid not null references public.profiles(id) on delete cascade,
  song_id bigint not null references public.song_pool(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  primary key(user_id, song_id)
);
create index song_feedback_song on public.song_feedback(song_id);

alter table public.song_pool enable row level security;
alter table public.artwork_songs enable row level security;
alter table public.song_feedback enable row level security;
create policy song_pool_read on public.song_pool for select to authenticated using (true);
create policy artwork_songs_read on public.artwork_songs for select to authenticated
  using (exists(select 1 from public.daily_artworks a where a.id = artwork_id and a.user_id = (select auth.uid())));
create policy song_feedback_read on public.song_feedback for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.song_pool, public.artwork_songs, public.song_feedback from public, anon, authenticated;
grant select on public.song_pool, public.artwork_songs, public.song_feedback to authenticated;
grant all on public.song_pool, public.artwork_songs, public.song_feedback to service_role;

-- Picks a song for the caller's own finished picture and returns
--   { "song": {id, videoId, title, channel} | null, "unchanged": boolean, "refill": mood | null }.
-- Without p_reroll an existing song is returned as is. A picture without a mood gets none.
-- "refill" means the pool has no usable row for the picture's mood (the API server answers 503).
-- Songs the caller disliked are skipped and liked ones are twice as likely.
create or replace function public.pick_song(p_date date, p_reroll boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_art public.daily_artworks; v_current bigint; v_song public.song_pool;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id = v_user and deleting_at is null;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || p_date::text, 0));
  select * into v_art from public.daily_artworks where user_id = v_user and artwork_date = p_date;
  if not found or v_art.status <> 'ready' then raise exception '완성된 그림에만 노래를 붙일 수 있어요.'; end if;
  select song_id into v_current from public.artwork_songs where artwork_id = v_art.id;
  if v_current is not null and not coalesce(p_reroll, false) then
    select * into v_song from public.song_pool where id = v_current;
    return jsonb_build_object('song', jsonb_build_object('id', v_song.id, 'videoId', v_song.video_id, 'title', v_song.title, 'channel', v_song.channel), 'unchanged', true, 'refill', null);
  end if;
  if v_art.mood is not null and not exists(select 1 from public.song_pool where mood = v_art.mood and fetched_at > now() - interval '30 days') then
    return jsonb_build_object('song', null, 'unchanged', true, 'refill', v_art.mood);
  end if;
  -- A NULL mood matches no row, so such a picture falls through to "nothing to offer".
  select s.* into v_song from public.song_pool s
    left join public.song_feedback f on f.song_id = s.id and f.user_id = v_user
    where s.mood = v_art.mood and s.fetched_at > now() - interval '30 days'
      and s.id is distinct from v_current and coalesce(f.vote, 0) <> -1
    order by random() * (case when f.vote = 1 then 2 else 1 end) desc limit 1;
  if not found then
    -- Nothing (else) to offer: keep the current song, or none.
    select * into v_song from public.song_pool where id = v_current;
    return jsonb_build_object('song', case when v_song.id is null then null else jsonb_build_object('id', v_song.id, 'videoId', v_song.video_id, 'title', v_song.title, 'channel', v_song.channel) end, 'unchanged', true, 'refill', null);
  end if;
  insert into public.artwork_songs(artwork_id, song_id) values(v_art.id, v_song.id)
    on conflict(artwork_id) do update set song_id = excluded.song_id;
  return jsonb_build_object('song', jsonb_build_object('id', v_song.id, 'videoId', v_song.video_id, 'title', v_song.title, 'channel', v_song.channel), 'unchanged', false, 'refill', null);
end; $$;

create or replace function public.vote_song(p_song bigint, p_vote integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  if p_vote is null or p_vote not in (-1, 1) then raise exception '입력 내용을 확인해 주세요.'; end if;
  perform 1 from public.profiles where id = v_user and deleting_at is null;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  if not exists(select 1 from public.song_pool where id = p_song) then raise exception '노래를 찾을 수 없어요.'; end if;
  insert into public.song_feedback(user_id, song_id, vote) values(v_user, p_song, p_vote)
    on conflict(user_id, song_id) do update set vote = excluded.vote;
end; $$;

revoke all on function public.pick_song(date,boolean), public.vote_song(bigint,integer) from public, anon, authenticated;
grant execute on function public.pick_song(date,boolean), public.vote_song(bigint,integer) to authenticated;
commit;
