begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

grant usage on schema cron, net to postgres;
grant all privileges on all tables in schema cron to postgres;

-- pg_net 0.20.4 grants its tables to PUBLIC. Pending request headers contain
-- the bearer secret, so remove inherited access before scheduling anything.
revoke all on net.http_request_queue, net._http_response from public, anon, authenticated;
revoke all on all sequences in schema net from public, anon, authenticated;
grant all on net.http_request_queue, net._http_response to postgres;
grant all on all sequences in schema net to postgres;

create schema harujogak_private authorization postgres;
revoke all on schema harujogak_private from public, anon, authenticated, service_role;

create table harujogak_private.worker_control (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  last_tick timestamptz,
  last_request_id bigint,
  last_dispatched_at timestamptz,
  last_outcome text not null default 'disabled',
  last_maintenance timestamptz
);
insert into harujogak_private.worker_control(singleton) values (true);

-- Only fixed classifications are retained; no HTTP body, headers, or secrets.
create table harujogak_private.worker_dispatches (
  request_id bigint primary key,
  dispatched_at timestamptz not null,
  finished_at timestamptz,
  http_status integer check (http_status between 100 and 599),
  outcome text not null
);
create index worker_dispatches_retention
  on harujogak_private.worker_dispatches(dispatched_at);
alter table harujogak_private.worker_control enable row level security;
alter table harujogak_private.worker_dispatches enable row level security;
revoke all on harujogak_private.worker_control, harujogak_private.worker_dispatches
  from public, anon, authenticated, service_role;

create function harujogak_private.worker_tick()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_control harujogak_private.worker_control%rowtype;
  v_response record;
  v_payload jsonb;
  v_secret text;
  v_secret_count integer;
  v_request_id bigint;
  v_outcome text;
  v_now timestamptz := pg_catalog.now();
begin
  -- Also serialize manual calls. This lock lasts for the SQL transaction,
  -- while the persistent request ID below guards the asynchronous HTTP work.
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('harujogak-artwork-worker', 0)
  ) then
    return 'tick_busy';
  end if;

  select * into strict v_control
  from harujogak_private.worker_control
  where singleton
  for update;

  update harujogak_private.worker_control set last_tick = v_now where singleton;
  if not v_control.enabled then
    update harujogak_private.worker_control set last_outcome = 'disabled' where singleton;
    return 'disabled';
  end if;

  if v_control.last_maintenance is null
    or v_control.last_maintenance < v_now - interval '1 day' then
    -- Limit retention cleanup to this application's own scheduler history.
    delete from cron.job_run_details d
    using cron.job j
    where d.jobid = j.jobid
      and j.jobname = 'harujogak-artwork-worker'
      and j.username = current_user
      and d.end_time < v_now - interval '7 days';
    delete from harujogak_private.worker_dispatches
    where dispatched_at < v_now - interval '14 days'
      and request_id is distinct from v_control.last_request_id;
    update harujogak_private.worker_control
      set last_maintenance = v_now where singleton;
  end if;

  -- Midnight is evaluated by the existing KST-aware, idempotent function.
  perform public.enqueue_closed_days();

  -- A final interrupted attempt must reach failed even when no other work is
  -- available. This is the same terminal transition as claim_artwork().
  update public.daily_artworks
  set status = 'failed',
      error_message = '생성이 중단됐어요. 다시 시도 횟수를 모두 사용했어요.'
  where status = 'processing'
    and claimed_at < v_now - interval '10 minutes'
    and attempts >= 3;

  if v_control.last_request_id is not null then
    select status_code, timed_out, error_msg, content into v_response
    from net._http_response where id = v_control.last_request_id;

    if found then
      -- Do not copy response content or error text to durable tables/logs.
      if coalesce(v_response.timed_out, false) or v_response.error_msg is not null then
        v_outcome := 'transport_error';
      elsif v_response.status_code is null
        or v_response.status_code not between 200 and 299 then
        v_outcome := 'http_error';
      else
        begin
          v_payload := v_response.content::jsonb;
        exception when others then
          v_payload := null;
        end;
        if v_payload -> 'processed' = 'false'::jsonb then
          v_outcome := 'no_work';
        elsif v_payload -> 'processed' = 'true'::jsonb
          and v_payload ->> 'status' in ('ready', 'failed', 'unknown') then
          v_outcome := v_payload ->> 'status';
        else
          v_outcome := 'invalid_response';
        end if;
      end if;

      update harujogak_private.worker_dispatches
      set finished_at = v_now,
          http_status = case when v_response.status_code between 100 and 599
            then v_response.status_code else null end,
          outcome = v_outcome
      where request_id = v_control.last_request_id and finished_at is null;
      update harujogak_private.worker_control
        set last_request_id = null, last_outcome = v_outcome where singleton;

    elsif exists (
      select 1 from net.http_request_queue where id = v_control.last_request_id
    ) or v_control.last_dispatched_at > v_now - interval '6 minutes' then
      -- A queued request can still be delivered after a delay. Do not add a
      -- second request simply because its wall-clock lease has elapsed.
      update harujogak_private.worker_control
        set last_outcome = 'pending_http' where singleton;
      return 'pending_http';
    else
      -- pg_net uses unlogged tables. A restart can lose transport state;
      -- artwork claims remain authoritative and are checked below.
      update harujogak_private.worker_dispatches
        set finished_at = v_now, outcome = 'lost_transport'
        where request_id = v_control.last_request_id and finished_at is null;
      update harujogak_private.worker_control
        set last_request_id = null, last_outcome = 'lost_transport' where singleton;
    end if;
  end if;

  -- A timeout does not prove that the remote worker stopped. Wait for the
  -- existing ten-minute claim expiry before allowing its recovery.
  if exists (
    select 1 from public.daily_artworks
    where status = 'processing'
      and (claimed_at is null or claimed_at >= v_now - interval '10 minutes')
  ) then
    update harujogak_private.worker_control
      set last_outcome = 'active_processing' where singleton;
    return 'active_processing';
  end if;

  if not exists (
    select 1 from public.daily_artworks a
    join public.profiles p on p.id = a.user_id
    where p.ai_consent_at is not null and a.attempts < 3
      and (a.status = 'queued' or (
        a.status = 'processing' and a.claimed_at < v_now - interval '10 minutes'
      ))
  ) then
    update harujogak_private.worker_control set last_outcome = 'idle' where singleton;
    return 'idle';
  end if;

  select count(*) into v_secret_count from vault.secrets
    where name = 'harujogak_worker_cron_secret';
  if v_secret_count <> 1 then
    update harujogak_private.worker_control set last_outcome = 'config_missing' where singleton;
    return 'config_missing';
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'harujogak_worker_cron_secret';
  if v_secret is null or pg_catalog.char_length(v_secret) not between 32 and 256
    or pg_catalog.strpos(v_secret, pg_catalog.chr(13)) > 0
    or pg_catalog.strpos(v_secret, pg_catalog.chr(10)) > 0 then
    update harujogak_private.worker_control set last_outcome = 'config_invalid' where singleton;
    return 'config_invalid';
  end if;

  begin
    select net.http_post(
      url := 'https://harujogak-hihellow18.vercel.app/api/jobs',
      body := '{}'::jsonb,
      params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret
      ),
      timeout_milliseconds := 330000
    ) into v_request_id;
    if v_request_id is null then
      raise exception 'HTTP request was not queued';
    end if;
    insert into harujogak_private.worker_dispatches(request_id, dispatched_at, outcome)
      values (v_request_id, v_now, 'queued_http');
    update harujogak_private.worker_control
      set last_request_id = v_request_id, last_dispatched_at = v_now,
          last_outcome = 'queued_http' where singleton;
  exception when others then
    -- The subtransaction rolls back both the pg_net enqueue and its ledger.
    -- Never expose SQLERRM: a transport error may include request headers.
    update harujogak_private.worker_control
      set last_outcome = 'dispatch_error' where singleton;
    return 'dispatch_error';
  end;
  return 'queued_http';
exception when others then
  -- Roll back this tick's data changes before recording a sanitized failure.
  update harujogak_private.worker_control
    set last_tick = v_now, last_outcome = 'tick_error' where singleton;
  return 'tick_error';
end;
$$;
alter function harujogak_private.worker_tick() owner to postgres;
revoke all on function harujogak_private.worker_tick()
  from public, anon, authenticated, service_role;

-- Temporary bootstrap endpoint: root provisions via a service-role request
-- and removes this function afterwards. It never changes enabled or replaces
-- an existing secret, and no secret literal belongs in a migration or cron SQL.
create function public.configure_harujogak_worker_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or pg_catalog.char_length(p_secret) not between 32 and 256
    or pg_catalog.strpos(p_secret, pg_catalog.chr(13)) > 0
    or pg_catalog.strpos(p_secret, pg_catalog.chr(10)) > 0 then
    raise exception 'Worker secret must be 32 to 256 characters without line breaks';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('harujogak-worker-secret-setup', 0)
  );
  if exists (select 1 from vault.secrets where name = 'harujogak_worker_cron_secret') then
    return false;
  end if;
  begin
    perform vault.create_secret(
      p_secret, 'harujogak_worker_cron_secret', 'Harujogak artwork worker authorization'
    );
  exception when others then
    raise exception 'Worker secret could not be configured';
  end;
  return true;
end;
$$;
alter function public.configure_harujogak_worker_secret(text) owner to postgres;
revoke all on function public.configure_harujogak_worker_secret(text)
  from public, anon, authenticated, service_role;
grant execute on function public.configure_harujogak_worker_secret(text) to service_role;

-- The cron itself is active, but the control row defaults to disabled.
-- Enabling generation is a separate, explicit post-provisioning operation.
select cron.schedule(
  'harujogak-artwork-worker', '* * * * *',
  'select harujogak_private.worker_tick();'
);

notify pgrst, 'reload schema';

commit;
