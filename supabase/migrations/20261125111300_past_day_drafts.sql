begin;
-- A past day without a picture is an editable draft. Only an explicit artwork request closes a
-- newly backfilled day; the existing automatic close still handles fragments written on their day.
-- Existing pictures, snapshots, per-day attempts, function signatures and ownership stay intact.

create or replace function public.save_team_entry(p_id uuid, p_content text, p_date date) returns public.entries
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_today date := (now() at time zone 'Asia/Seoul')::date; v_row public.entries; v_status text;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id=v_user and deleting_at is null for no key update;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  if p_date is null or p_date > v_today then raise exception '오늘이나 지난 날에만 조각글을 남길 수 있어요.'; end if;
  select * into v_row from public.entries where id=p_id and user_id=v_user;
  if found then return v_row; end if;
  if p_content is null or char_length(btrim(p_content)) not between 1 and 500 then raise exception '조각글은 1~500자로 남겨 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || p_date::text, 0));
  select status into v_status from public.daily_artworks where user_id=v_user and artwork_date=p_date;
  if v_status in ('queued','processing') then
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
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  -- Use the same profile -> day lock order as saving, removing and manual/automatic closing.
  perform 1 from public.profiles where id=v_user and deleting_at is null for no key update;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  if p_content is null or char_length(btrim(p_content)) not between 1 and 500 then raise exception '조각글은 1~500자로 남겨 주세요.'; end if;
  select entry_date into v_date from public.entries where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Seoul')::date then raise exception '오늘이나 지난 날의 조각글만 바꿀 수 있어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_date::text, 0));
  select status into v_status from public.daily_artworks where user_id=v_user and artwork_date=v_date;
  if v_status in ('queued','processing') then
    raise exception '그림을 그리는 중이에요. 완성된 뒤에 고쳐 주세요.';
  end if;
  update public.entries set content=btrim(p_content) where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
end; $$;

create or replace function public.remove_team_entry(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_date date; v_art public.daily_artworks;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id=v_user and deleting_at is null for no key update;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  select entry_date into v_date from public.entries where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Seoul')::date then raise exception '오늘이나 지난 날의 조각글만 바꿀 수 있어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_date::text, 0));
  select * into v_art from public.daily_artworks where user_id=v_user and artwork_date=v_date for update;
  if v_art.status in ('queued','processing') then
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

create or replace function public.enqueue_closed_days() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  -- At least one original, on-day fragment keeps the old automatic-close behavior. Using ALL would
  -- incorrectly exempt an ordinary day just because a late fragment was added before its close.
  -- created_at is assigned by the database; callers cannot backdate it through the writing RPCs.
  for r in select distinct e.user_id,e.entry_date from public.entries e
    join public.profiles p on p.id=e.user_id
    where e.entry_date < (now() at time zone 'Asia/Seoul')::date
      and (e.created_at at time zone 'Asia/Seoul')::date <= e.entry_date
      and p.ai_consent_at is not null and p.deleting_at is null
      and not exists(select 1 from public.daily_artworks a where a.user_id=e.user_id and a.artwork_date=e.entry_date)
  loop
    perform 1 from public.profiles where id=r.user_id and ai_consent_at is not null and deleting_at is null for no key update skip locked;
    if not found then continue; end if;
    perform pg_advisory_xact_lock(hashtextextended(r.user_id::text || r.entry_date::text, 0));
    -- A candidate may have been deleted or explicitly closed while this tick acquired its locks.
    -- Recheck under the day lock, so removing the last fragment cannot abort the shared tick.
    if not exists(select 1 from public.entries e where e.user_id=r.user_id and e.entry_date=r.entry_date
      and (e.created_at at time zone 'Asia/Seoul')::date <= e.entry_date)
      or exists(select 1 from public.daily_artworks a where a.user_id=r.user_id and a.artwork_date=r.entry_date)
    then continue; end if;
    perform public.close_day_for(r.user_id,r.entry_date); n := n+1;
  end loop;
  return n;
end; $$;

revoke all on function public.save_team_entry(uuid,text,date),public.edit_entry(uuid,text),public.remove_team_entry(uuid) from public,anon,authenticated;
grant execute on function public.save_team_entry(uuid,text,date),public.edit_entry(uuid,text),public.remove_team_entry(uuid) to authenticated;
revoke all on function public.enqueue_closed_days() from public,anon,authenticated;
grant execute on function public.enqueue_closed_days() to service_role;
commit;
