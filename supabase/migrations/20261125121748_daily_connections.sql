begin;

-- Private, cached news connections. A job's date identifies the journal, not the news publication
-- date: every explicit request freezes the latest seven-day news window at the time of that request.
create table public.daily_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  status text not null default 'queued' check(status in ('queued','processing','ready','no_match','failed','cancelled')),
  stage text not null default 'topics' check(stage in ('topics','searching','drawing')),
  entry_snapshot jsonb not null default '[]' check(jsonb_typeof(entry_snapshot)='array' and jsonb_array_length(entry_snapshot)<=30),
  artwork_summary text check(char_length(artwork_summary)<=2000),
  artwork_tags text[] not null default '{}' check(cardinality(artwork_tags)<=20),
  input_fingerprint text check(input_fingerprint is null or char_length(input_fingerprint)=32),
  topics jsonb not null default '[]' check(jsonb_typeof(topics)='array' and jsonb_array_length(topics)<=10),
  headline text check(char_length(headline)<=200),
  summary text check(char_length(summary)<=2000),
  connection_reason text check(char_length(connection_reason)<=1000),
  caption text check(char_length(caption)<=500),
  sources jsonb not null default '[]' check(jsonb_typeof(sources)='array' and jsonb_array_length(sources)<=10),
  image_prompt text check(char_length(image_prompt)<=6000),
  image_path text,
  selected_at timestamptz,
  news_from timestamptz not null default now()-interval '7 days',
  news_to timestamptz not null default now(),
  attempts integer not null default 1 check(attempts between 1 and 3),
  claim_token uuid,
  claimed_at timestamptz,
  retry_after timestamptz,
  error_message text check(char_length(error_message)<=500),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  last_request_id uuid not null,
  request_ids uuid[] not null default '{}' check(cardinality(request_ids)<=3),
  unique(user_id,entry_date),
  check(news_from<=news_to),
  check(status<>'processing' or (claim_token is not null and claimed_at is not null))
);
create index daily_connections_queue on public.daily_connections(status,created_at);
alter table public.daily_connections enable row level security;
create policy daily_connections_owner on public.daily_connections for select to authenticated using (
  user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.id=user_id and p.deleting_at is null)
);
revoke all on public.daily_connections from public,anon,authenticated;
grant select on public.daily_connections to authenticated;
grant all on public.daily_connections to service_role;
create trigger connections_active_owner before insert or update on public.daily_connections
  for each row execute function public.guard_active_journal_owner();

-- Deleting and rewriting a journal cannot reset its lifetime three-request budget.
create table public.deleted_connection_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  attempts integer not null check(attempts between 1 and 3),
  request_ids uuid[] not null default '{}' check(cardinality(request_ids)<=3),
  primary key(user_id,entry_date)
);
alter table public.deleted_connection_attempts enable row level security;
revoke all on public.deleted_connection_attempts from public,anon,authenticated;
grant all on public.deleted_connection_attempts to service_role;

-- Only trusted server code can ask for another user's input. The authenticated request RPC below
-- always supplies auth.uid(). Keep timestamp ordering deterministic when two fragments share a time.
create function public.current_connection_input(p_user uuid,p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_entries jsonb; v_summary text; v_tags text[]; v_input jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('content',content,'created_at',created_at) order by created_at,id),'[]')
    into v_entries from public.entries where user_id=p_user and entry_date=p_date;
  select scene_summary,tags into v_summary,v_tags from public.daily_artworks
    where user_id=p_user and artwork_date=p_date and status='ready';
  -- Old artwork columns were not length-constrained. Normalize only the copied input, not the
  -- original picture, and fingerprint exactly this bounded representation.
  v_summary:=left(v_summary,2000);
  select coalesce(array_agg(t.tag order by t.position),'{}') into v_tags from (
    select left(btrim(u.tag),200) as tag,u.position from unnest(coalesce(v_tags,'{}')) with ordinality as u(tag,position)
      where nullif(btrim(u.tag),'') is not null order by u.position limit 20
  ) t;
  v_input := jsonb_build_object('entry_snapshot',v_entries,'artwork_summary',v_summary,'artwork_tags',coalesce(v_tags,'{}'));
  return v_input || jsonb_build_object('input_fingerprint',md5(v_input::text));
end; $$;
revoke all on function public.current_connection_input(uuid,date) from public,anon,authenticated;
grant execute on function public.current_connection_input(uuid,date) to service_role;

create function public.request_daily_connection(p_date date,p_refresh boolean,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_job public.daily_connections; v_input jsonb; v_used integer; v_ids uuid[]; v_id uuid;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  if p_date is null or p_date>(now() at time zone 'Asia/Seoul')::date or p_refresh is null or p_request_id is null then
    raise exception '요청 날짜와 내용을 확인해 주세요.';
  end if;
  perform 1 from public.profiles where id=v_user and ai_consent_at is not null and deleting_at is null for no key update;
  if not found then raise exception '프로필에서 AI 전송에 동의해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||p_date::text,0));
  select * into v_job from public.daily_connections where user_id=v_user and entry_date=p_date for update;
  if found then
    if v_job.last_request_id=p_request_id or p_request_id=any(v_job.request_ids) then return v_job.id; end if;
    if v_job.status='queued' or (v_job.status='processing' and v_job.claimed_at>=now()-interval '10 minutes') then return v_job.id; end if;
    if v_job.status in ('ready','no_match') and not p_refresh then return v_job.id; end if;
    if v_job.status='cancelled' and v_job.claimed_at>=now()-interval '10 minutes' then
      raise exception '취소한 하루연결 작업을 정리하고 있어요. 잠시 뒤 다시 시도해 주세요.';
    end if;
    if v_job.attempts>=3 then raise exception '이날 하루연결 생성 시도 3회를 모두 사용했어요.'; end if;
    if v_job.status='failed' and (v_job.retry_after is null or v_job.retry_after>now()) then
      raise exception '하루연결은 실패 후 5분 뒤 다시 시도할 수 있어요.';
    end if;
  end if;
  v_input:=public.current_connection_input(v_user,p_date);
  if jsonb_array_length(v_input->'entry_snapshot')=0 then raise exception '먼저 이날의 조각글을 남겨 주세요.'; end if;
  if v_job.id is null then
    select attempts,request_ids into v_used,v_ids from public.deleted_connection_attempts where user_id=v_user and entry_date=p_date;
    v_used:=coalesce(v_used,0); v_ids:=coalesce(v_ids,'{}');
    if p_request_id=any(v_ids) then raise exception '이미 처리한 요청이에요. 새 요청으로 다시 시도해 주세요.'; end if;
    if v_used>=3 then raise exception '이날 하루연결 생성 시도 3회를 모두 사용했어요.'; end if;
    insert into public.daily_connections(user_id,entry_date,entry_snapshot,artwork_summary,artwork_tags,input_fingerprint,attempts,last_request_id,request_ids)
      values(v_user,p_date,v_input->'entry_snapshot',v_input->>'artwork_summary',
        array(select jsonb_array_elements_text(v_input->'artwork_tags')),v_input->>'input_fingerprint',v_used+1,p_request_id,array_append(v_ids,p_request_id))
      returning id into v_id;
    return v_id;
  end if;
  update public.daily_connections set status='queued',stage='topics',attempts=attempts+1,
    entry_snapshot=v_input->'entry_snapshot',artwork_summary=v_input->>'artwork_summary',
    artwork_tags=array(select jsonb_array_elements_text(v_input->'artwork_tags')),input_fingerprint=v_input->>'input_fingerprint',
    topics='[]',headline=null,summary=null,connection_reason=null,caption=null,sources='[]',image_prompt=null,
    selected_at=null,news_from=now()-interval '7 days',news_to=now(),claim_token=null,claimed_at=null,
    retry_after=null,error_message=null,completed_at=null,last_request_id=p_request_id,request_ids=array_append(request_ids,p_request_id)
    where id=v_job.id;
  -- image_path deliberately survives until the worker has durably saved its replacement.
  return v_job.id;
end; $$;
revoke all on function public.request_daily_connection(date,boolean,uuid) from public,anon,authenticated;
grant execute on function public.request_daily_connection(date,boolean,uuid) to authenticated;

create function public.claim_daily_connection(p_id uuid default null) returns setof public.daily_connections
language plpgsql security definer set search_path='' as $$
declare r record; v_job public.daily_connections; v_stale boolean;
begin
  for r in select c.id,c.user_id,c.entry_date from public.daily_connections c
    join public.profiles p on p.id=c.user_id
    where (p_id is null or c.id=p_id) and p.ai_consent_at is not null and p.deleting_at is null
      and (c.status='queued' or (c.status='processing' and c.claimed_at<now()-interval '10 minutes'))
    order by c.created_at,c.id
  loop
    -- Match request/edit/delete lock ordering and skip occupied profiles/days instead of deadlocking.
    perform 1 from public.profiles where id=r.user_id and ai_consent_at is not null and deleting_at is null for no key update skip locked;
    if not found then continue; end if;
    if not pg_try_advisory_xact_lock(hashtextextended(r.user_id::text||r.entry_date::text,0)) then continue; end if;
    select * into v_job from public.daily_connections where id=r.id for update skip locked;
    if not found then continue; end if;
    v_stale:=v_job.status='processing' and v_job.claimed_at<now()-interval '10 minutes';
    if v_stale and v_job.attempts>=3 then
      update public.daily_connections set status='failed',claim_token=gen_random_uuid(),claimed_at=null,retry_after=null,
        entry_snapshot='[]',artwork_summary=null,artwork_tags='{}',
        error_message='하루연결 생성이 중단됐어요. 이날의 생성 시도 3회를 모두 사용했어요.' where id=v_job.id;
      continue;
    end if;
    if v_job.status<>'queued' and not v_stale then continue; end if;
    return query update public.daily_connections set status='processing',
      stage=case when nullif(btrim(image_prompt),'') is not null then 'drawing' when jsonb_array_length(topics)>0 then 'searching' else 'topics' end,
      attempts=attempts+case when v_stale then 1 else 0 end,claim_token=gen_random_uuid(),claimed_at=now(),retry_after=null,error_message=null
      where id=v_job.id returning *;
    return;
  end loop;
end; $$;
revoke all on function public.claim_daily_connection(uuid) from public,anon,authenticated;
grant execute on function public.claim_daily_connection(uuid) to service_role;

create function public.cancel_connections_on_consent_withdrawal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.daily_connections set status='cancelled',claim_token=gen_random_uuid(),
    claimed_at=case when status='processing' then claimed_at else null end,
    entry_snapshot='[]',artwork_summary=null,artwork_tags='{}',input_fingerprint=null,topics='[]',
    headline=null,summary=null,connection_reason=null,caption=null,sources='[]',image_prompt=null,
    selected_at=null,retry_after=null,error_message='AI 전송 동의를 철회해 하루연결 생성을 취소했어요.',completed_at=now()
    where user_id=new.id and status in ('queued','processing');
  return new;
end; $$;
create trigger connections_consent_withdrawn after update of ai_consent_at on public.profiles
  for each row when(old.ai_consent_at is not null and new.ai_consent_at is null)
  execute function public.cancel_connections_on_consent_withdrawal();

create function public.guard_connection_last_entry() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.entries where user_id=old.user_id and entry_date=old.entry_date and id<>old.id)
    and exists(select 1 from public.daily_connections where user_id=old.user_id and entry_date=old.entry_date
      and status in ('processing','cancelled') and claimed_at>=now()-interval '10 minutes') then
    raise exception '하루연결 작업을 정리하고 있어요. 잠시 뒤 마지막 조각글을 지워 주세요.';
  end if;
  return old;
end; $$;
create trigger connection_last_entry_guard before delete on public.entries for each row execute function public.guard_connection_last_entry();

create function public.remove_connection_without_entries() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.entries where user_id=old.user_id and entry_date=old.entry_date) then
    delete from public.daily_connections where user_id=old.user_id and entry_date=old.entry_date;
  end if;
  return old;
end; $$;
create trigger connection_last_entry_removed after delete on public.entries for each row execute function public.remove_connection_without_entries();

create function public.preserve_connection_attempts() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- During auth-user cascade there is no owner left and no reason to retain an anonymous ledger.
  if exists(select 1 from auth.users where id=old.user_id) then
    insert into public.deleted_connection_attempts(user_id,entry_date,attempts,request_ids) values(old.user_id,old.entry_date,old.attempts,old.request_ids)
      on conflict(user_id,entry_date) do update set attempts=greatest(public.deleted_connection_attempts.attempts,excluded.attempts),
        request_ids=array(select distinct unnest(public.deleted_connection_attempts.request_ids||excluded.request_ids));
  end if;
  return old;
end; $$;
create trigger connection_attempts_before_delete before delete on public.daily_connections for each row execute function public.preserve_connection_attempts();
revoke all on function public.cancel_connections_on_consent_withdrawal(),public.guard_connection_last_entry(),
  public.remove_connection_without_entries(),public.preserve_connection_attempts() from public,anon,authenticated,service_role;

create or replace function public.begin_account_deletion() returns void
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  perform 1 from public.profiles where id=v_user for no key update;
  if not found then raise exception '계정을 찾을 수 없어요.'; end if;
  if exists(select 1 from public.daily_artworks where user_id=v_user and status in ('queued','processing')) then
    raise exception '대기 중인 그림 생성이 끝난 뒤 탈퇴해 주세요.';
  end if;
  if exists(select 1 from public.daily_connections where user_id=v_user and status in ('processing','cancelled') and claimed_at>=now()-interval '10 minutes') then
    raise exception '하루연결 작업을 정리하고 있어요. 잠시 뒤 탈퇴를 다시 시도해 주세요.';
  end if;
  update public.daily_connections set status='cancelled',claim_token=gen_random_uuid(),claimed_at=null,
    entry_snapshot='[]',artwork_summary=null,artwork_tags='{}',input_fingerprint=null,topics='[]',connection_reason=null,
    caption=null,image_prompt=null,retry_after=null,completed_at=now()
    where user_id=v_user and status in ('queued','processing','failed');
  update public.profiles set deleting_at=coalesce(deleting_at,now()),ai_consent_at=null where id=v_user;
end; $$;
revoke all on function public.begin_account_deletion() from public,anon,authenticated;
grant execute on function public.begin_account_deletion() to authenticated;

-- Images use the existing private artworks bucket at user_id/connection-id/claim_token.png.
-- No new client write grants or public Storage policy are introduced.
notify pgrst,'reload schema';

-- CONNECTION DISPATCHER: separate control/HTTP request IDs from the existing artwork worker.
create table harujogak_private.connection_worker_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  last_tick timestamptz,last_request_id bigint,last_dispatched_at timestamptz,
  last_outcome text not null default 'disabled',last_maintenance timestamptz
);
insert into harujogak_private.connection_worker_control(singleton) values(true);
create table harujogak_private.connection_worker_dispatches (
  request_id bigint primary key,dispatched_at timestamptz not null,finished_at timestamptz,
  http_status integer check(http_status between 100 and 599),outcome text not null
);
create index connection_worker_dispatches_retention on harujogak_private.connection_worker_dispatches(dispatched_at);
alter table harujogak_private.connection_worker_control enable row level security;
alter table harujogak_private.connection_worker_dispatches enable row level security;
revoke all on harujogak_private.connection_worker_control,harujogak_private.connection_worker_dispatches from public,anon,authenticated,service_role;

create function harujogak_private.connection_worker_tick() returns text
language plpgsql security definer set search_path='' as $$
declare v_control harujogak_private.connection_worker_control; v_response record; v_payload jsonb;
  v_secret text; v_secret_count integer; v_request_id bigint; v_outcome text; v_now timestamptz:=now();
begin
  if not pg_try_advisory_xact_lock(hashtextextended('harujogak-connection-worker',0)) then return 'tick_busy'; end if;
  select * into strict v_control from harujogak_private.connection_worker_control where singleton for update;
  update harujogak_private.connection_worker_control set last_tick=v_now where singleton;
  if not v_control.enabled then
    update harujogak_private.connection_worker_control set last_outcome='disabled' where singleton; return 'disabled';
  end if;
  if v_control.last_maintenance is null or v_control.last_maintenance<v_now-interval '1 day' then
    delete from cron.job_run_details d using cron.job j where d.jobid=j.jobid and j.jobname='harujogak-connection-worker'
      and j.username=current_user and d.end_time<v_now-interval '7 days';
    delete from harujogak_private.connection_worker_dispatches where dispatched_at<v_now-interval '14 days'
      and request_id is distinct from v_control.last_request_id;
    update harujogak_private.connection_worker_control set last_maintenance=v_now where singleton;
  end if;
  if v_control.last_request_id is not null then
    select status_code,timed_out,error_msg,content into v_response from net._http_response where id=v_control.last_request_id;
    if found then
      if coalesce(v_response.timed_out,false) or v_response.error_msg is not null then v_outcome:='transport_error';
      elsif v_response.status_code is null or v_response.status_code not between 200 and 299 then v_outcome:='http_error';
      else
        begin v_payload:=v_response.content::jsonb; exception when others then v_payload:=null; end;
        if v_payload->'processed'='false'::jsonb then v_outcome:='no_work';
        elsif v_payload->'processed'='true'::jsonb and v_payload->>'status' in ('ready','queued','failed','no_match','cancelled','unknown','superseded') then v_outcome:=v_payload->>'status';
        else v_outcome:='invalid_response'; end if;
      end if;
      update harujogak_private.connection_worker_dispatches set finished_at=v_now,
        http_status=case when v_response.status_code between 100 and 599 then v_response.status_code end,outcome=v_outcome
        where request_id=v_control.last_request_id and finished_at is null;
      update harujogak_private.connection_worker_control set last_request_id=null,last_outcome=v_outcome where singleton;
    elsif exists(select 1 from net.http_request_queue where id=v_control.last_request_id)
      or v_control.last_dispatched_at>v_now-interval '6 minutes' then
      update harujogak_private.connection_worker_control set last_outcome='pending_http' where singleton; return 'pending_http';
    else
      update harujogak_private.connection_worker_dispatches set finished_at=v_now,outcome='lost_transport'
        where request_id=v_control.last_request_id and finished_at is null;
      update harujogak_private.connection_worker_control set last_request_id=null,last_outcome='lost_transport' where singleton;
    end if;
  end if;
  if exists(select 1 from public.daily_connections where status='processing' and claimed_at>=v_now-interval '10 minutes') then
    update harujogak_private.connection_worker_control set last_outcome='active_processing' where singleton; return 'active_processing';
  end if;
  if not exists(select 1 from public.daily_connections c join public.profiles p on p.id=c.user_id
    where p.ai_consent_at is not null and p.deleting_at is null
      and (c.status='queued' or (c.status='processing' and c.claimed_at<v_now-interval '10 minutes'))) then
    update harujogak_private.connection_worker_control set last_outcome='idle' where singleton; return 'idle';
  end if;
  select count(*) into v_secret_count from vault.secrets where name='harujogak_worker_cron_secret';
  if v_secret_count<>1 then
    update harujogak_private.connection_worker_control set last_outcome='config_missing' where singleton; return 'config_missing';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='harujogak_worker_cron_secret';
  if v_secret is null or char_length(v_secret) not between 32 and 256 or strpos(v_secret,chr(13))>0 or strpos(v_secret,chr(10))>0 then
    update harujogak_private.connection_worker_control set last_outcome='config_invalid' where singleton; return 'config_invalid';
  end if;
  begin
    select net.http_post(url:='https://harujogak-hihellow18.vercel.app/api/connection-jobs',body:='{}'::jsonb,params:='{}'::jsonb,
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),timeout_milliseconds:=330000)
      into v_request_id;
    if v_request_id is null then raise exception 'HTTP request was not queued'; end if;
    insert into harujogak_private.connection_worker_dispatches(request_id,dispatched_at,outcome) values(v_request_id,v_now,'queued_http');
    update harujogak_private.connection_worker_control set last_request_id=v_request_id,last_dispatched_at=v_now,last_outcome='queued_http' where singleton;
  exception when others then
    update harujogak_private.connection_worker_control set last_outcome='dispatch_error' where singleton; return 'dispatch_error';
  end;
  return 'queued_http';
exception when others then
  update harujogak_private.connection_worker_control set last_tick=v_now,last_outcome='tick_error' where singleton; return 'tick_error';
end; $$;
alter function harujogak_private.connection_worker_tick() owner to postgres;
revoke all on function harujogak_private.connection_worker_tick() from public,anon,authenticated,service_role;
select cron.schedule('harujogak-connection-worker','* * * * *','select harujogak_private.connection_worker_tick();');
commit;
