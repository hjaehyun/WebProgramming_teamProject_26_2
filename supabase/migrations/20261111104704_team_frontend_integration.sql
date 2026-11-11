begin;
-- Additive integration with the existing production schema; no data reset.
alter table public.profiles add column onboarded boolean not null default false;
alter table public.profiles add column deleting_at timestamptz;
update public.profiles set onboarded = true where ai_consent_at is not null or nickname <> '기록하는 사람';
alter table public.profiles drop constraint profiles_art_style_check;
alter table public.profiles add constraint profiles_art_style_check check (art_style in ('watercolor','pencil','gouache','crayon','story'));
grant update(onboarded) on public.profiles to authenticated;
alter table public.daily_artworks add column scene text not null default 'day' check (scene in ('day','cat','rain','park','cafe','night'));
alter table public.daily_artworks add column tags text[] not null default '{}';
alter table public.daily_artworks add column last_request_id uuid;

-- Legacy write RPCs remain available to the old app. Block them as well once
-- deletion starts; callers cannot bypass the API's deletion-state guard.
create function public.guard_active_journal_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=new.user_id and deleting_at is null) then
    raise exception '탈퇴 정리가 진행 중이에요. 탈퇴를 다시 시도해 주세요.';
  end if;
  return new;
end; $$;
create trigger entries_active_owner before insert or update on public.entries for each row execute function public.guard_active_journal_owner();
create trigger artworks_active_owner before insert or update on public.daily_artworks for each row execute function public.guard_active_journal_owner();
create trigger exhibitions_active_owner before insert or update on public.exhibitions for each row execute function public.guard_active_journal_owner();
revoke all on function public.guard_active_journal_owner() from public,anon,authenticated;

create function public.save_team_entry(p_id uuid, p_content text, p_date date) returns public.entries
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_row public.entries;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  -- NO KEY UPDATE permits the KEY SHARE lock used by legacy entry/artwork
  -- inserts while they hold the day lock, avoiding a profile/day lock cycle.
  perform 1 from public.profiles where id=v_user and deleting_at is null for no key update;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  if p_date is distinct from (now() at time zone 'Asia/Seoul')::date then raise exception '오늘 날짜에만 조각글을 남길 수 있어요.'; end if;
  select * into v_row from public.entries where id=p_id and user_id=v_user;
  if found then return v_row; end if;
  select * into v_row from public.add_entry(p_content);
  update public.entries set id=p_id where id=v_row.id returning * into v_row;
  return v_row;
end; $$;

create function public.edit_entry(p_id uuid, p_content text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_date date;
begin
  if p_content is null or char_length(btrim(p_content)) not between 1 and 500 then raise exception '조각글은 1~500자로 남겨 주세요.'; end if;
  select entry_date into v_date from public.entries where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_date::text,0));
  if v_date <> (now() at time zone 'Asia/Seoul')::date or exists(select 1 from public.daily_artworks where user_id=v_user and artwork_date=v_date) then raise exception '마감된 날의 조각글은 바꿀 수 없어요.'; end if;
  update public.entries set content=btrim(p_content) where id=p_id and user_id=v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
end; $$;

-- Retries use the same claim fencing and total three-attempt limit as the old worker.
create function public.request_team_artwork(p_date date, p_redraw boolean, p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_job public.daily_artworks; v_style text; v_id uuid;
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
  update public.daily_artworks set status='queued', error_message=null, last_request_id=p_request_id,
    art_style=case when p_redraw then v_style else art_style end,
    image_prompt=case when p_redraw then null else image_prompt end
  where id=v_job.id;
  return v_job.id;
end; $$;

create or replace function public.claim_artwork(p_id uuid default null) returns setof public.daily_artworks
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.daily_artworks a set status='failed', error_message='생성이 중단됐어요. 다시 시도 횟수를 모두 사용했어요.'
    where status='processing' and claimed_at < now()-interval '10 minutes' and attempts>=3
    and exists(select 1 from public.profiles p where p.id=a.user_id and p.deleting_at is null);
  select a.id into v_id from public.daily_artworks a join public.profiles p on p.id=a.user_id
    where (p_id is null or a.id=p_id) and p.ai_consent_at is not null and p.deleting_at is null and a.attempts<3 and
    (a.status='queued' or (a.status='processing' and a.claimed_at < now()-interval '10 minutes'))
    order by a.created_at for update of a skip locked for no key update of p skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.daily_artworks set status='processing', attempts=attempts+1, claimed_at=now(), claim_token=gen_random_uuid(), error_message=null where id=v_id returning *;
end; $$;

-- One cleanup-pending user must not make the shared automatic-close tick fail,
-- even if an old client restores their AI-consent column directly.
create or replace function public.enqueue_closed_days() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select distinct e.user_id,e.entry_date from public.entries e
    join public.profiles p on p.id=e.user_id
    where e.entry_date < (now() at time zone 'Asia/Seoul')::date
      and p.ai_consent_at is not null and p.deleting_at is null
      and not exists(select 1 from public.daily_artworks a where a.user_id=e.user_id and a.artwork_date=e.entry_date)
  loop
    -- Recheck under the same profile lock used by deletion. The candidate
    -- query alone can become stale while another request starts cleanup.
    perform 1 from public.profiles where id=r.user_id and ai_consent_at is not null and deleting_at is null for no key update skip locked;
    if not found then continue; end if;
    perform public.close_day_for(r.user_id,r.entry_date); n := n+1;
  end loop;
  return n;
end; $$;

create function public.save_team_exhibition(p_dates date[] default null, p_public boolean default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id=v_user and deleting_at is null for no key update;
  if not found then raise exception '계정 상태를 확인해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':exhibition',0));
  if coalesce(cardinality(p_dates),0)>100 then raise exception '전시에는 최대 100장까지 담을 수 있어요.'; end if;
  -- Keep the selected rows stable until replacement commits. Without this,
  -- a redraw between validation and INSERT could silently drop a selection.
  perform 1 from public.daily_artworks where user_id=v_user and artwork_date=any(p_dates) order by artwork_date for share;
  if p_dates is not null and (select count(*) from public.daily_artworks where user_id=v_user and status='ready' and artwork_date=any(p_dates)) <> cardinality(p_dates) then raise exception '완성된 내 그림만 전시할 수 있어요.'; end if;
  select id into v_id from public.exhibitions where user_id=v_user order by created_at,id limit 1;
  if v_id is null then insert into public.exhibitions(user_id,title) values(v_user,'나의 하루조각') returning id into v_id; end if;
  if p_dates is not null then
    delete from public.exhibition_items where exhibition_id=v_id;
    insert into public.exhibition_items(exhibition_id,artwork_id,position)
      select v_id,a.id,d.ord::integer-1 from unnest(p_dates) with ordinality d(day,ord)
      join public.daily_artworks a on a.user_id=v_user and a.artwork_date=d.day and a.status='ready';
  end if;
  if p_public is not null then update public.exhibitions set is_public=p_public where id=v_id; end if;
  return v_id;
end; $$;

create function public.begin_account_deletion() returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id=v_user for no key update;
  if not found then raise exception '계정을 찾을 수 없어요.'; end if;
  if exists(select 1 from public.daily_artworks where user_id=v_user and status in ('queued','processing')) then raise exception '대기 중인 그림 생성이 끝난 뒤 탈퇴해 주세요.'; end if;
  update public.profiles set deleting_at=coalesce(deleting_at,now()), ai_consent_at=null where id=v_user;
end; $$;

create table public.ai_daily_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  kind text not null check(kind='curation'),
  calls integer not null default 0 check(calls between 0 and 8),
  primary key(user_id,usage_date,kind)
);
alter table public.ai_daily_usage enable row level security;
create policy ai_usage_owner on public.ai_daily_usage for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.ai_daily_usage from public,anon,authenticated;
grant select on public.ai_daily_usage to authenticated;
grant all on public.ai_daily_usage to service_role;
create function public.reserve_curation() returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid := auth.uid(); v_count integer;
begin
  if not exists(select 1 from public.profiles where id=v_user and ai_consent_at is not null and deleting_at is null) then raise exception '프로필에서 AI 전송에 동의해 주세요.'; end if;
  insert into public.ai_daily_usage(user_id,usage_date,kind,calls) values(v_user,(now() at time zone 'Asia/Seoul')::date,'curation',1)
  on conflict(user_id,usage_date,kind) do update set calls=public.ai_daily_usage.calls+1 where public.ai_daily_usage.calls<8 returning calls into v_count;
  if v_count is null then raise exception '오늘의 큐레이터 사용 한도 8회를 모두 사용했어요.'; end if;
end; $$;

revoke all on function public.save_team_entry(uuid,text,date),public.edit_entry(uuid,text),public.request_team_artwork(date,boolean,uuid),public.save_team_exhibition(date[],boolean),public.begin_account_deletion(),public.reserve_curation() from public,anon,authenticated;
grant execute on function public.save_team_entry(uuid,text,date),public.edit_entry(uuid,text),public.request_team_artwork(date,boolean,uuid),public.save_team_exhibition(date[],boolean),public.begin_account_deletion(),public.reserve_curation() to authenticated;
commit;
