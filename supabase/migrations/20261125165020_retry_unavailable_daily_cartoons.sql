begin;

-- Only an explicit manual request may retry an edition whose news evidence was
-- insufficient. Existing one-argument callers (including cron) keep their old
-- behavior through the wrapper below. There is deliberately no default on the
-- new argument, so named RPC arguments identify one unambiguous signature.
create or replace function public.claim_daily_cartoon(p_date date, p_retry_unavailable boolean)
returns setof public.daily_cartoons language plpgsql security invoker set search_path = '' as $$
declare v_job public.daily_cartoons;
begin
  if p_date is null or not isfinite(p_date) or p_date > (now() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 또는 지난 날짜의 만평만 처리할 수 있어요.';
  end if;
  select * into v_job from public.daily_cartoons where cartoon_date = p_date for update skip locked;
  if not found then return; end if;

  if v_job.status = 'processing' and v_job.claimed_at < now() - interval '10 minutes' and v_job.attempts >= 3 then
    update public.daily_cartoons set status = 'failed', retry_after = null,
      error_message = '만평 생성이 중단됐어요. 이날의 생성 시도 횟수를 모두 사용했어요.'
      where cartoon_date = p_date;
    return;
  end if;

  if v_job.attempts >= 3 or not (
    v_job.status = 'queued'
    or (v_job.status = 'failed' and v_job.retry_after is not null and v_job.retry_after <= now())
    -- Older unavailable rows have no retry deadline; they are eligible only
    -- when the user explicitly requests a fresh search, within the same budget.
    or (v_job.status = 'unavailable' and p_retry_unavailable is true
      and (v_job.retry_after is null or v_job.retry_after <= now()))
    or (v_job.status = 'processing' and coalesce(v_job.claimed_at < now() - interval '10 minutes', false))
  ) then return; end if;

  return query update public.daily_cartoons set status = 'processing',
    stage = case when nullif(btrim(image_prompt), '') is not null then 'drawing' else 'searching' end,
    attempts = attempts + 1, claim_token = gen_random_uuid(), claimed_at = now(),
    retry_after = null, error_message = null, completed_at = null
    where cartoon_date = p_date returning *;
end;
$$;

create or replace function public.claim_daily_cartoon(p_date date)
returns setof public.daily_cartoons language sql security invoker set search_path = '' as $$
  select * from public.claim_daily_cartoon(p_date, false);
$$;

revoke all on function public.claim_daily_cartoon(date), public.claim_daily_cartoon(date, boolean) from public, anon, authenticated;
grant execute on function public.claim_daily_cartoon(date), public.claim_daily_cartoon(date, boolean) to service_role;

commit;
