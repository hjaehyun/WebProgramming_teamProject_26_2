begin;
-- Missing mood (legacy pictures or an unclear AI result) uses the calm song list.
-- This is a music default, not an inferred mood: never update the artwork, its
-- snapshot, image, generation attempts, or mood. No AI call or redraw is needed.
-- Replace only the function; preserve all existing songs, links, and feedback.
create or replace function public.pick_song(p_date date, p_reroll boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_art public.daily_artworks; v_current bigint; v_song public.song_pool; v_mood text;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id = v_user and deleting_at is null;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || p_date::text, 0));
  select * into v_art from public.daily_artworks where user_id = v_user and artwork_date = p_date;
  if not found or v_art.status <> 'ready' then raise exception '완성된 그림에만 노래를 붙일 수 있어요.'; end if;
  v_mood := coalesce(v_art.mood, 'calm');
  select song_id into v_current from public.artwork_songs where artwork_id = v_art.id;
  if v_current is not null and not coalesce(p_reroll, false) then
    select * into v_song from public.song_pool where id = v_current;
    return jsonb_build_object('song', jsonb_build_object('id', v_song.id, 'videoId', v_song.video_id, 'title', v_song.title, 'channel', v_song.channel), 'unchanged', true, 'refill', null);
  end if;
  if not exists(select 1 from public.song_pool where mood = v_mood and fetched_at > now() - interval '30 days') then
    return jsonb_build_object('song', null, 'unchanged', true, 'refill', v_mood);
  end if;
  select s.* into v_song from public.song_pool s
    left join public.song_feedback f on f.song_id = s.id and f.user_id = v_user
    where s.mood = v_mood and s.fetched_at > now() - interval '30 days'
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

-- Keep this owner-checked RPC callable only by signed-in users and trusted roles.
revoke all on function public.pick_song(date,boolean) from public, anon;
grant execute on function public.pick_song(date,boolean) to authenticated;
commit;
