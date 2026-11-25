begin;

-- Optional owner-only description. Existing accounts and artwork requests stay opt-out.
alter table public.profiles
  add column art_profile jsonb not null default '{}'::jsonb,
  add column art_profile_enabled boolean not null default false,
  add constraint profiles_art_profile_valid check (case when jsonb_typeof(art_profile) = 'object' then
      (art_profile - array['gender','ageRange','occupation','appearance']::text[]) = '{}'::jsonb
      and (not (art_profile ? 'gender') or (jsonb_typeof(art_profile->'gender') = 'string'
        and art_profile->>'gender' in ('unspecified','female','male','neutral')))
      and (not (art_profile ? 'ageRange') or (jsonb_typeof(art_profile->'ageRange') = 'string'
        and art_profile->>'ageRange' in ('unspecified','child','teen','20s','30s','40s','50s','60plus')))
      and (not (art_profile ? 'occupation') or (jsonb_typeof(art_profile->'occupation') = 'string'
        and char_length(art_profile->>'occupation') <= 80 and (art_profile->>'occupation') !~ '[[:cntrl:]]'))
      and (not (art_profile ? 'appearance') or (jsonb_typeof(art_profile->'appearance') = 'string'
        and char_length(art_profile->>'appearance') <= 200 and (art_profile->>'appearance') !~ '[[:cntrl:]]'))
    else false end),
  add constraint profiles_art_profile_consent check (not art_profile_enabled or ai_consent_at is not null);
alter table public.daily_artworks
  add column profile_snapshot jsonb not null default '{}'::jsonb,
  add constraint artwork_profile_snapshot_valid check (case when jsonb_typeof(profile_snapshot) = 'object' then
      (profile_snapshot - array['gender','ageRange','occupation','appearance']::text[]) = '{}'::jsonb
      and (not (profile_snapshot ? 'gender') or (jsonb_typeof(profile_snapshot->'gender') = 'string'
        and profile_snapshot->>'gender' in ('unspecified','female','male','neutral')))
      and (not (profile_snapshot ? 'ageRange') or (jsonb_typeof(profile_snapshot->'ageRange') = 'string'
        and profile_snapshot->>'ageRange' in ('unspecified','child','teen','20s','30s','40s','50s','60plus')))
      and (not (profile_snapshot ? 'occupation') or (jsonb_typeof(profile_snapshot->'occupation') = 'string'
        and char_length(profile_snapshot->>'occupation') <= 80 and (profile_snapshot->>'occupation') !~ '[[:cntrl:]]'))
      and (not (profile_snapshot ? 'appearance') or (jsonb_typeof(profile_snapshot->'appearance') = 'string'
        and char_length(profile_snapshot->>'appearance') <= 200 and (profile_snapshot->>'appearance') !~ '[[:cntrl:]]'))
    else false end);

-- Existing owner RLS continues to protect reads and these two added update columns.
-- Browsers cannot write the generation snapshot or enable another account's profile.
grant update(art_profile,art_profile_enabled) on public.profiles to authenticated;

-- Old clients can withdraw AI consent without knowing the new switch exists.
-- This trigger only changes NEW; it reads no table and needs no elevated rights.
create function public.disable_art_profile_without_consent() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.ai_consent_at is null then new.art_profile_enabled := false; end if;
  return new;
end;
$$;
revoke all on function public.disable_art_profile_without_consent() from public,anon,authenticated,service_role;
create trigger profiles_art_profile_consent
  before insert or update of ai_consent_at,art_profile_enabled on public.profiles
  for each row execute function public.disable_art_profile_without_consent();

-- Preserve idempotent closure, deleted-day attempt counts and the existing day lock.
-- Only an explicitly enabled profile is captured; blank/unspecified details are omitted.
create or replace function public.close_day_for(p_user uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_style text; v_snapshot jsonb; v_used integer; v_profile jsonb;
begin
  if p_date > (now() at time zone 'Asia/Seoul')::date then raise exception '미래의 날짜는 마감할 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_date::text, 0));
  select id into v_id from public.daily_artworks where user_id = p_user and artwork_date = p_date;
  if found then return v_id; end if;
  select art_style, case when art_profile_enabled then jsonb_strip_nulls(jsonb_build_object(
      'gender', nullif(art_profile->>'gender','unspecified'),
      'ageRange', nullif(art_profile->>'ageRange','unspecified'),
      'occupation', nullif(btrim(art_profile->>'occupation'),''),
      'appearance', nullif(btrim(art_profile->>'appearance'),'')
    )) else '{}'::jsonb end into v_style,v_profile
    from public.profiles where id = p_user and ai_consent_at is not null;
  if not found then raise exception '설정에서 AI 그림 생성에 동의해 주세요.'; end if;
  select jsonb_agg(jsonb_build_object('content', content, 'created_at', created_at) order by created_at) into v_snapshot
    from public.entries where user_id = p_user and entry_date = p_date;
  if v_snapshot is null then raise exception '먼저 조각글을 남겨 주세요.'; end if;
  select coalesce(max(attempts), 0) into v_used from public.deleted_artwork_attempts where user_id = p_user and artwork_date = p_date;
  insert into public.daily_artworks(user_id, artwork_date, art_style, entry_snapshot, profile_snapshot, attempts, status, error_message)
    values(p_user, p_date, v_style, v_snapshot, v_profile, v_used,
      case when v_used >= 3 then 'failed' else 'queued' end,
      case when v_used >= 3 then '이날 그림은 3회를 모두 그렸어요.' end)
    returning id into v_id;
  return v_id;
end; $$;

-- Manual retry/redraw takes current details just as it takes current fragments.
-- A changed effective profile invalidates an old image prompt; in-flight/ready reads do not.
create or replace function public.request_team_artwork(p_date date, p_redraw boolean, p_request_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_job public.daily_artworks; v_style text; v_id uuid;
  v_snapshot jsonb; v_changed boolean; v_profile jsonb;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  select art_style, case when art_profile_enabled then jsonb_strip_nulls(jsonb_build_object(
      'gender', nullif(art_profile->>'gender','unspecified'),
      'ageRange', nullif(art_profile->>'ageRange','unspecified'),
      'occupation', nullif(btrim(art_profile->>'occupation'),''),
      'appearance', nullif(btrim(art_profile->>'appearance'),'')
    )) else '{}'::jsonb end into v_style,v_profile
    from public.profiles where id=v_user and ai_consent_at is not null and deleting_at is null for no key update;
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
  v_changed := (select array_agg(e->>'content' order by e->>'content') from jsonb_array_elements(v_snapshot) e)
    is distinct from (select array_agg(e->>'content' order by e->>'content') from jsonb_array_elements(v_job.entry_snapshot) e);
  v_changed := v_changed or (v_profile is distinct from v_job.profile_snapshot);
  update public.daily_artworks set status='queued', error_message=null, last_request_id=p_request_id,
    art_style=case when p_redraw then v_style else art_style end,
    image_prompt=case when p_redraw or v_changed then null else image_prompt end,
    entry_snapshot=v_snapshot,profile_snapshot=v_profile
  where id=v_job.id;
  return v_job.id;
end; $$;

-- Replacements retain their existing capabilities; no privileged entry point is newly exposed.
revoke all on function public.close_day_for(uuid,date) from public,anon,authenticated;
grant execute on function public.close_day_for(uuid,date) to service_role;
revoke all on function public.request_team_artwork(date,boolean,uuid) from public,anon,authenticated;
grant execute on function public.request_team_artwork(date,boolean,uuid) to authenticated;
commit;
