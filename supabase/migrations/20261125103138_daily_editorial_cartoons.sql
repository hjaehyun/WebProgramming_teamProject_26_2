begin;

-- A shared editorial cartoon made only from public news. No journal/user foreign keys.
create table public.daily_cartoons (
  cartoon_date date primary key,
  status text not null default 'queued' check (status in ('queued','processing','ready','failed','unavailable')),
  stage text not null default 'searching' check (stage in ('searching','drawing')),
  headline text check (char_length(headline) <= 200),
  summary text check (char_length(summary) <= 2000),
  selection_reason text check (char_length(selection_reason) <= 1000),
  caption text check (char_length(caption) <= 500),
  image_prompt text check (char_length(image_prompt) <= 6000),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 10),
  image_path text,
  selected_at timestamptz,
  completed_at timestamptz,
  claim_token uuid,
  claimed_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  retry_after timestamptz,
  error_message text check (char_length(error_message) <= 500),
  created_at timestamptz not null default now()
);

alter table public.daily_cartoons enable row level security;
-- All signed-in readers see the same public-news result, with column privileges
-- keeping worker state and prompts inaccessible even through direct Data API calls.
create policy daily_cartoons_read on public.daily_cartoons for select to authenticated using (true);
revoke all on public.daily_cartoons from public, anon, authenticated;
grant select (cartoon_date,status,stage,headline,summary,selection_reason,caption,sources,
  selected_at,completed_at,retry_after,error_message,created_at) on public.daily_cartoons to authenticated;
grant all on public.daily_cartoons to service_role;

-- Both RPCs act with the worker's own privileges; browser roles cannot execute them.
-- Repeated enqueue requests do not reset an existing day's state or retry budget.
create function public.enqueue_daily_cartoon(p_date date default (now() at time zone 'Asia/Seoul')::date)
returns setof public.daily_cartoons language plpgsql security invoker set search_path = '' as $$
begin
  if p_date is distinct from (now() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 날짜의 만평만 요청할 수 있어요.';
  end if;
  return query insert into public.daily_cartoons(cartoon_date) values(p_date)
    on conflict(cartoon_date) do nothing returning *;
end;
$$;

create function public.claim_daily_cartoon(p_date date)
returns setof public.daily_cartoons language plpgsql security invoker set search_path = '' as $$
declare v_job public.daily_cartoons;
begin
  if p_date is distinct from (now() at time zone 'Asia/Seoul')::date then
    raise exception '오늘 날짜의 만평만 처리할 수 있어요.';
  end if;
  -- A single row lock fences simultaneous request/cron workers for this date.
  select * into v_job from public.daily_cartoons where cartoon_date = p_date for update skip locked;
  if not found then return; end if;

  if v_job.status = 'processing' and v_job.claimed_at < now() - interval '10 minutes' and v_job.attempts >= 3 then
    update public.daily_cartoons set status = 'failed', retry_after = null,
      error_message = '만평 생성이 중단됐어요. 오늘의 생성 시도 횟수를 모두 사용했어요.'
      where cartoon_date = p_date;
    return;
  end if;

  if v_job.attempts >= 3 or not (
    v_job.status = 'queued'
    -- Failed jobs become eligible only at the worker's explicit retry deadline
    -- (the worker sets retry_after to failure time + 15 minutes).
    or (v_job.status = 'failed' and v_job.retry_after is not null and v_job.retry_after <= now())
    or (v_job.status = 'processing' and coalesce(v_job.claimed_at < now() - interval '10 minutes', false))
  ) then return; end if;

  return query update public.daily_cartoons set status = 'processing',
    stage = case when nullif(btrim(image_prompt), '') is not null then 'drawing' else 'searching' end,
    attempts = attempts + 1, claim_token = gen_random_uuid(), claimed_at = now(),
    retry_after = null, error_message = null, completed_at = null
    where cartoon_date = p_date returning *;
end;
$$;

revoke all on function public.enqueue_daily_cartoon(date), public.claim_daily_cartoon(date) from public, anon, authenticated;
grant execute on function public.enqueue_daily_cartoon(date), public.claim_daily_cartoon(date) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('news-cartoons','news-cartoons',false,10485760,array['image/png','image/webp'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
-- Restrict only this bucket, even if another permissive Storage policy is broad.
-- The service role bypasses RLS and alone uploads/signs these private images.
create policy news_cartoons_server_only on storage.objects as restrictive for all to anon,authenticated
  using (bucket_id <> 'news-cartoons') with check (bucket_id <> 'news-cartoons');

commit;
