begin;
-- Additive: fragments of a day that already has a picture can be added, edited and removed.
--
-- * The picture is not redrawn automatically. A redraw or retry re-reads the day's current fragments
--   (the snapshot used to be frozen at close time), within the existing three-attempt limit.
-- * While a picture is queued or being drawn, its day's fragments cannot change.
-- * Removing the last fragment of such a day removes the picture as well (exhibition items and songs
--   cascade). The API server then deletes the picture's files. The attempts the picture had used are
--   kept per day, so deleting and rewriting a day never grants more than three generations.
-- * A past day without a picture still cannot receive fragments.
-- Requires 20261111104704_team_frontend_integration.sql. Every function keeps its signature and grants,
-- except remove_team_entry, which is new; the legacy remove_entry keeps its old rules.

create table public.deleted_artwork_attempts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  artwork_date date not null,
  attempts integer not null check (attempts between 0 and 3),
  primary key(user_id, artwork_date)
);
alter table public.deleted_artwork_attempts enable row level security;
revoke all on public.deleted_artwork_attempts from public, anon, authenticated;
grant all on public.deleted_artwork_attempts to service_role;

-- Unchanged except that a day whose picture was deleted resumes from the attempts already used.
-- A day with none left is closed as failed instead of raising, so the shared automatic-close tick
-- never stops on one user (a queued job with attempts=3 would also never be claimed).
create or replace function public.close_day_for(p_user uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_style text; v_snapshot jsonb; v_used integer;
begin
  if p_date > (now() at time zone 'Asia/Seoul')::date then raise exception '미래의 날짜는 마감할 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_date::text, 0));
  select id into v_id from public.daily_artworks where user_id = p_user and artwork_date = p_date;
  if found then return v_id; end if;
  select art_style into v_style from public.profiles where id = p_user and ai_consent_at is not null;
  if not found then raise exception '설정에서 AI 그림 생성에 동의해 주세요.'; end if;
  select jsonb_agg(jsonb_build_object('content', content, 'created_at', created_at) order by created_at) into v_snapshot from public.entries where user_id = p_user and entry_date = p_date;
  if v_snapshot is null then raise exception '먼저 조각글을 남겨 주세요.'; end if;
  select coalesce(max(attempts), 0) into v_used from public.deleted_artwork_attempts where user_id = p_user and artwork_date = p_date;
  insert into public.daily_artworks(user_id, artwork_date, art_style, entry_snapshot, attempts, status, error_message)
    values(p_user, p_date, v_style, v_snapshot, v_used,
      case when v_used >= 3 then 'failed' else 'queued' end,
      case when v_used >= 3 then '이날 그림은 3회를 모두 그렸어요.' end)
    returning id into v_id;
  return v_id;
end; $$;

create or replace function public.save_team_entry(p_id uuid, p_content text, p_date date) returns public.entries
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_today date := (now() at time zone 'Asia/Seoul')::date; v_row public.entries; v_status text;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  -- Same lock order as before: profile (NO KEY UPDATE), then the day.
  perform 1 from public.profiles where id=v_user and deleting_at is null for no key update;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  if p_date is null or p_date > v_today then raise exception '오늘이나 지난 날에만 조각글을 남길 수 있어요.'; end if;
  select * into v_row from public.entries where id=p_id and user_id=v_user;
  if found then return v_row; end if;
  if p_content is null or char_length(btrim(p_content)) not between 1 and 500 then raise exception '조각글은 1~500자로 남겨 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || p_date::text, 0));
  select status into v_status from public.daily_artworks where user_id=v_user and artwork_date=p_date;
  if not found then
    if p_date <> v_today then raise exception '지난 날에는 그림이 있는 날에만 조각을 더할 수 있어요.'; end if;
  elsif v_status in ('queued','processing') then
    raise exception '그림을 그리는 중이에요. 완성된 뒤에 조각을 더해 주세요.';
  end if;
  if (select count(*) from public.entries where user_id=v_user and entry_date=p_date) >= 30 then raise exception '하루에 조각글 30개까지 남길 수 있어요.'; end if;
  insert into public.entries(id, user_id, content, entry_date) values(p_id, v_user, btrim(p_content), p_date) returning * into v_row;
  return v_row;
end; $$;

create or replace function public.edit_entry(p_id uuid, p_content text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_date date; v_status text;
begin
  if p_content is null or char_length(btrim(p_content)) not between 1 and 500 then raise exception '조각글은 1~500자로 남겨 주세요.'; end if;
  select entry_date into v_date from public.entries where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_date::text, 0));
  select status into v_status from public.daily_artworks where user_id=v_user and artwork_date=v_date;
  if not found then
    if v_date <> (now() at time zone 'Asia/Seoul')::date then raise exception '마감된 날의 조각글은 바꿀 수 없어요.'; end if;
  elsif v_status in ('queued','processing') then
    raise exception '그림을 그리는 중이에요. 완성된 뒤에 고쳐 주세요.';
  end if;
  update public.entries set content=btrim(p_content) where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
end; $$;

-- Returns the id of the picture removed together with the day's last fragment, otherwise NULL.
create function public.remove_team_entry(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_date date; v_art public.daily_artworks;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id=v_user and deleting_at is null for no key update;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  select entry_date into v_date from public.entries where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_date::text, 0));
  select * into v_art from public.daily_artworks where user_id=v_user and artwork_date=v_date for update;
  if not found then
    if v_date <> (now() at time zone 'Asia/Seoul')::date then raise exception '마감된 날의 조각글은 바꿀 수 없어요.'; end if;
  elsif v_art.status in ('queued','processing') then
    raise exception '그림을 그리는 중이에요. 완성된 뒤에 지워 주세요.';
  end if;
  delete from public.entries where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
  if v_art.id is null or exists(select 1 from public.entries where user_id=v_user and entry_date=v_date) then return null; end if;
  insert into public.deleted_artwork_attempts(user_id, artwork_date, attempts) values(v_user, v_date, v_art.attempts)
    on conflict(user_id, artwork_date) do update set attempts=greatest(public.deleted_artwork_attempts.attempts, excluded.attempts);
  delete from public.daily_artworks where id=v_art.id;
  return v_art.id;
end; $$;

-- Unchanged except that a retry or redraw draws the day's current fragments. A failed job whose
-- fragments changed is summarized again instead of resuming from its saved prompt.
create or replace function public.request_team_artwork(p_date date, p_redraw boolean, p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_job public.daily_artworks; v_style text; v_id uuid; v_snapshot jsonb; v_changed boolean;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  select art_style into v_style from public.profiles where id=v_user and ai_consent_at is not null and deleting_at is null for no key update;
  if not found then raise exception '프로필에서 AI 전송에 동의해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || p_date::text,0));
  select * into v_job from public.daily_artworks where user_id=v_user and artwork_date=p_date for update;
  if not found then
    if p_redraw then raise exception '그림을 찾을 수 없어요.'; end if;
    v_id := public.close_day(p_date);
    update public.daily_artworks set last_request_id=p_request_id where id=v_id;
    return v_id;
  end if;
  if v_job.last_request_id=p_request_id then return v_job.id; end if;
  if v_job.status in ('queued','processing') then return v_job.id; end if;
  if v_job.status='ready' and not p_redraw then return v_job.id; end if;
  if v_job.attempts>=3 then raise exception '이날 그림의 생성 시도 3회를 모두 사용했어요.'; end if;
  select jsonb_agg(jsonb_build_object('content',content,'created_at',created_at) order by created_at) into v_snapshot
    from public.entries where user_id=v_user and entry_date=p_date;
  if v_snapshot is null then raise exception '먼저 조각글을 남겨 주세요.'; end if;
  -- Compared by text only: timestamps in old snapshots may be serialized in another time zone.
  v_changed := (select array_agg(e->>'content' order by e->>'content') from jsonb_array_elements(v_snapshot) e)
    is distinct from (select array_agg(e->>'content' order by e->>'content') from jsonb_array_elements(v_job.entry_snapshot) e);
  update public.daily_artworks set status='queued', error_message=null, last_request_id=p_request_id,
    art_style=case when p_redraw then v_style else art_style end,
    image_prompt=case when p_redraw or v_changed then null else image_prompt end,
    entry_snapshot=v_snapshot
  where id=v_job.id;
  return v_job.id;
end; $$;

revoke all on function public.remove_team_entry(uuid) from public, anon, authenticated;
grant execute on function public.remove_team_entry(uuid) to authenticated;
commit;
