begin;
-- Trash: a deleted fragment, and a picture that goes with a day's last fragment, are moved into
-- their own tables for 30 days instead of being deleted. Everything that reads entries or
-- daily_artworks keeps reading only the live tables, so nothing in the trash can reach a drawing,
-- a connection, a cartoon, the curator or an exhibition. Exhibition items, song links and the
-- day's connection still go away exactly as before; they are not kept or restored.
-- The server removes a picture's files before purging its row (and the worker purges expired
-- items), so the picture files stay in Storage only while the picture is in the trash.

create table public.trashed_artworks (
  id uuid primary key,                         -- the original daily_artworks.id
  user_id uuid not null references public.profiles(id) on delete cascade,
  artwork_date date not null,
  data jsonb not null,                         -- the original row, restored as is
  image_path text,
  deleted_at timestamptz not null default now()
);
-- Keyed per owner: a client may save a new fragment under an id it used before (a retried save
-- after a deletion). Deleting it again replaces the older trashed copy of that same fragment.
create table public.trashed_entries (
  id uuid not null,                            -- the original entries.id
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_date date not null,
  data jsonb not null,
  artwork_id uuid references public.trashed_artworks(id) on delete set null, -- trashed together with this picture
  deleted_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index trashed_entries_owner on public.trashed_entries(user_id, deleted_at desc);
create index trashed_entries_expiry on public.trashed_entries(deleted_at);
create index trashed_entries_bundle on public.trashed_entries(artwork_id);
create index trashed_artworks_owner on public.trashed_artworks(user_id, deleted_at desc);
create index trashed_artworks_expiry on public.trashed_artworks(deleted_at);

alter table public.trashed_entries enable row level security;
alter table public.trashed_artworks enable row level security;
revoke all on public.trashed_entries, public.trashed_artworks from public, anon, authenticated;
grant select on public.trashed_entries, public.trashed_artworks to authenticated;
grant all on public.trashed_entries, public.trashed_artworks to service_role;
create policy trashed_entries_read on public.trashed_entries for select to authenticated using (user_id = (select auth.uid()));
create policy trashed_artworks_read on public.trashed_artworks for select to authenticated using (user_id = (select auth.uid()));

-- Same signature and return value as before (the picture's id when it went with the last
-- fragment); the rows are copied into the trash before they leave the live tables.
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
  insert into public.trashed_entries(id, user_id, entry_date, data)
    select e.id, e.user_id, e.entry_date, to_jsonb(e) from public.entries e where e.id=p_id and e.user_id=v_user
    on conflict (user_id, id) do update set entry_date=excluded.entry_date, data=excluded.data, artwork_id=null, deleted_at=now();
  delete from public.entries where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
  if v_art.id is null or exists(select 1 from public.entries where user_id=v_user and entry_date=v_date) then return null; end if;
  insert into public.trashed_artworks(id, user_id, artwork_date, data, image_path)
    values(v_art.id, v_user, v_date, to_jsonb(v_art), v_art.image_path);
  update public.trashed_entries set artwork_id=v_art.id where id=p_id and user_id=v_user;
  insert into public.deleted_artwork_attempts(user_id, artwork_date, attempts) values(v_user, v_date, v_art.attempts)
    on conflict(user_id, artwork_date) do update set attempts=greatest(public.deleted_artwork_attempts.attempts, excluded.attempts);
  delete from public.daily_artworks where id=v_art.id;
  return v_art.id;
end; $$;

-- Puts trashed fragments back on their day, keeping id, time, date and weather. Shared checks of
-- the day: no picture being drawn, at most 30 fragments.
create function public.restore_trash_entries(p_user uuid, p_date date, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.daily_artworks where user_id=p_user and artwork_date=p_date;
  if v_status in ('queued','processing') then raise exception '그림을 그리는 중이에요. 완성된 뒤에 되살려 주세요.'; end if;
  if exists(select 1 from public.entries where id = any(p_ids)) then
    raise exception '같은 조각이 이미 기록에 있어요. 휴지통의 예전 내용은 완전 삭제해 주세요.';
  end if;
  if (select count(*) from public.entries where user_id=p_user and entry_date=p_date) + coalesce(array_length(p_ids, 1), 0) > 30 then
    raise exception '하루에 조각글 30개까지 남길 수 있어요. 이날 조각을 줄인 뒤 되살려 주세요.';
  end if;
  insert into public.entries
    select (jsonb_populate_record(null::public.entries, t.data)).* from public.trashed_entries t
    where t.user_id=p_user and t.id = any(p_ids);
  delete from public.trashed_entries where user_id=p_user and id = any(p_ids);
end; $$;
revoke all on function public.restore_trash_entries(uuid,date,uuid[]) from public, anon, authenticated;

create function public.restore_trash_item(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_entry public.trashed_entries; v_art public.trashed_artworks;
  v_live public.daily_artworks; v_bundle uuid[]; v_attempts integer;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id=v_user and deleting_at is null for no key update;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;

  select * into v_entry from public.trashed_entries where id=p_id and user_id=v_user;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_entry.entry_date::text, 0));
    perform public.restore_trash_entries(v_user, v_entry.entry_date, array[p_id]);
    -- A day whose picture is in the trash gets that picture back with the fragment. Otherwise the
    -- automatic close would draw a new picture for it and the trashed one could never return.
    if not exists(select 1 from public.daily_artworks where user_id=v_user and artwork_date=v_entry.entry_date) then
      select id into p_id from public.trashed_artworks where user_id=v_user and artwork_date=v_entry.entry_date
        order by deleted_at desc limit 1;
      if found then return public.restore_trash_item(p_id); end if;
    end if;
    return jsonb_build_object('restored', 'entry', 'date', v_entry.entry_date);
  end if;

  select * into v_art from public.trashed_artworks where id=p_id and user_id=v_user;
  if not found then raise exception '휴지통에서 찾을 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_art.artwork_date::text, 0));
  select coalesce(array_agg(id), '{}') into v_bundle from public.trashed_entries where user_id=v_user and artwork_id=p_id;
  select * into v_live from public.daily_artworks where user_id=v_user and artwork_date=v_art.artwork_date for update;

  if v_live.id is not null then
    -- Never replace the day's current picture: bring back the fragments only.
    if v_live.status in ('queued','processing') then raise exception '그림을 그리는 중이에요. 완성된 뒤에 되살려 주세요.'; end if;
    if cardinality(v_bundle) = 0 then raise exception '이날 다른 그림이 있어 이 그림은 되살릴 수 없어요.'; end if;
    perform public.restore_trash_entries(v_user, v_art.artwork_date, v_bundle);
    return jsonb_build_object('restored', 'entry_only', 'date', v_art.artwork_date);
  end if;

  if cardinality(v_bundle) > 0 then perform public.restore_trash_entries(v_user, v_art.artwork_date, v_bundle); end if;
  if not exists(select 1 from public.entries where user_id=v_user and entry_date=v_art.artwork_date) then
    raise exception '조각이 없는 날의 그림은 되살릴 수 없어요. 이날 조각을 먼저 되살려 주세요.';
  end if;
  -- Attempts used on this day while the picture was away still count toward the 3-attempt limit.
  select attempts into v_attempts from public.deleted_artwork_attempts where user_id=v_user and artwork_date=v_art.artwork_date;
  insert into public.daily_artworks
    select (jsonb_populate_record(null::public.daily_artworks,
      jsonb_set(v_art.data, '{attempts}', to_jsonb(greatest((v_art.data->>'attempts')::integer, coalesce(v_attempts, 0)))))).*;
  delete from public.deleted_artwork_attempts where user_id=v_user and artwork_date=v_art.artwork_date;
  delete from public.trashed_artworks where id=p_id and user_id=v_user;
  return jsonb_build_object('restored', 'artwork', 'date', v_art.artwork_date);
end; $$;

-- Permanent deletion of one item; a picture takes the fragments trashed with it. The server has
-- already removed the picture's files.
create function public.purge_trash_item(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  delete from public.trashed_entries where id=p_id and user_id=v_user;
  if found then return; end if;
  delete from public.trashed_entries where artwork_id=p_id and user_id=v_user;
  delete from public.trashed_artworks where id=p_id and user_id=v_user;
  if not found then raise exception '휴지통에서 찾을 수 없어요.'; end if;
end; $$;

-- Empties the caller's trash up to the moment the server listed it (and removed those files),
-- so an item trashed meanwhile is kept. Returns the number of rows removed.
create function public.empty_trash(p_until timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_entries integer; v_artworks integer;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  delete from public.trashed_entries where user_id=v_user and deleted_at <= p_until;
  get diagnostics v_entries = row_count;
  delete from public.trashed_artworks where user_id=v_user and deleted_at <= p_until;
  get diagnostics v_artworks = row_count;
  return v_entries + v_artworks;
end; $$;

revoke all on function public.restore_trash_item(uuid), public.purge_trash_item(uuid), public.empty_trash(timestamptz) from public, anon, authenticated;
grant execute on function public.restore_trash_item(uuid), public.purge_trash_item(uuid), public.empty_trash(timestamptz) to authenticated;
commit;
