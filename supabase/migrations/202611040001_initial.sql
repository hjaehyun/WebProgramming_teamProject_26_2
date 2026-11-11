-- Run once in the Supabase SQL editor (or `supabase db push`).
begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null default '기록하는 사람' check (char_length(nickname) between 1 and 30),
  art_style text not null default 'watercolor' check (art_style in ('watercolor', 'pencil', 'gouache')),
  ai_consent_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 500),
  entry_date date not null default (now() at time zone 'Asia/Seoul')::date,
  created_at timestamptz not null default now()
);
create index entries_user_day on public.entries(user_id, entry_date, created_at);
create table public.daily_artworks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  artwork_date date not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  art_style text not null,
  entry_snapshot jsonb not null,
  title text,
  scene_summary text,
  image_prompt text,
  image_path text,
  error_message text,
  attempts integer not null default 0 check (attempts between 0 and 3),
  claim_token uuid,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(user_id, artwork_date)
);
create index artworks_queue on public.daily_artworks(status, created_at);
-- Stage 2 schema: private until the explicit publication flow is implemented.
create table public.exhibitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.exhibition_items (
  exhibition_id uuid not null references public.exhibitions(id) on delete cascade,
  artwork_id uuid not null references public.daily_artworks(id) on delete cascade,
  position integer not null default 0,
  caption text not null default '' check (char_length(caption) <= 500),
  primary key(exhibition_id, artwork_id)
);
create index exhibitions_user on public.exhibitions(user_id);
create index exhibition_items_artwork on public.exhibition_items(artwork_id);

alter table public.profiles enable row level security;
alter table public.entries enable row level security;
alter table public.daily_artworks enable row level security;
alter table public.exhibitions enable row level security;
alter table public.exhibition_items enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy entries_read on public.entries for select to authenticated using (user_id = (select auth.uid()));
create policy artworks_read on public.daily_artworks for select to authenticated using (user_id = (select auth.uid()));
create policy exhibitions_read on public.exhibitions for select to authenticated using (user_id = (select auth.uid()));
create policy exhibition_items_read on public.exhibition_items for select to authenticated using (exists(select 1 from public.exhibitions e where e.id = exhibition_id and e.user_id = (select auth.uid())));
revoke all on public.profiles, public.entries, public.daily_artworks, public.exhibitions, public.exhibition_items from anon, authenticated;
grant select on public.profiles, public.entries, public.daily_artworks, public.exhibitions, public.exhibition_items to authenticated;
grant update(nickname, art_style, ai_consent_at) on public.profiles to authenticated;
grant all on public.profiles, public.entries, public.daily_artworks, public.exhibitions, public.exhibition_items to service_role;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values(new.id);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
insert into public.profiles(id) select id from auth.users on conflict do nothing;

-- All entry changes and closing use the SAME advisory lock to freeze a coherent day.
create function public.add_entry(p_content text) returns public.entries language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_date date := (now() at time zone 'Asia/Seoul')::date; v_row public.entries;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  if p_content is null or char_length(btrim(p_content)) not between 1 and 500 then raise exception '조각글은 1~500자로 남겨 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_date::text, 0));
  if exists(select 1 from public.daily_artworks where user_id = v_user and artwork_date = v_date) then raise exception '오늘은 이미 마감했어요. 내일 다시 만나요.'; end if;
  if (select count(*) from public.entries where user_id = v_user and entry_date = v_date) >= 30 then raise exception '하루에 조각글 30개까지 남길 수 있어요.'; end if;
  insert into public.entries(user_id, content, entry_date) values(v_user, btrim(p_content), v_date) returning * into v_row;
  return v_row;
end;
$$;
create function public.remove_entry(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_date date;
begin
  select entry_date into v_date from public.entries where id = p_id and user_id = v_user;
  if not found then raise exception '조각글을 찾을 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || v_date::text, 0));
  if v_date <> (now() at time zone 'Asia/Seoul')::date or exists(select 1 from public.daily_artworks where user_id = v_user and artwork_date = v_date) then raise exception '마감된 날의 조각글은 바꿀 수 없어요.'; end if;
  delete from public.entries where id = p_id and user_id = v_user;
end;
$$;

create function public.close_day_for(p_user uuid, p_date date) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_style text; v_snapshot jsonb;
begin
  if p_date > (now() at time zone 'Asia/Seoul')::date then raise exception '미래의 날짜는 마감할 수 없어요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || p_date::text, 0));
  select id into v_id from public.daily_artworks where user_id = p_user and artwork_date = p_date;
  if found then return v_id; end if;
  select art_style into v_style from public.profiles where id = p_user and ai_consent_at is not null;
  if not found then raise exception '설정에서 AI 그림 생성에 동의해 주세요.'; end if;
  select jsonb_agg(jsonb_build_object('content', content, 'created_at', created_at) order by created_at) into v_snapshot from public.entries where user_id = p_user and entry_date = p_date;
  if v_snapshot is null then raise exception '먼저 조각글을 남겨 주세요.'; end if;
  insert into public.daily_artworks(user_id, artwork_date, art_style, entry_snapshot) values(p_user, p_date, v_style, v_snapshot) returning id into v_id;
  return v_id;
end;
$$;
create function public.close_day(p_date date) returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요.'; end if;
  return public.close_day_for(auth.uid(), p_date);
end;
$$;
create function public.retry_artwork(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id = auth.uid() and ai_consent_at is not null) then raise exception 'AI 그림 생성 동의가 필요해요.'; end if;
  update public.daily_artworks set status = 'queued', error_message = null where id = p_id and user_id = auth.uid() and status = 'failed' and attempts < 3;
  if not found then raise exception '다시 시도할 수 없어요. 생성은 하루에 최대 3회 시도할 수 있어요.'; end if;
end;
$$;
create function public.enqueue_closed_days() returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select distinct e.user_id, e.entry_date from public.entries e join public.profiles p on p.id=e.user_id where e.entry_date < (now() at time zone 'Asia/Seoul')::date and p.ai_consent_at is not null and not exists(select 1 from public.daily_artworks a where a.user_id=e.user_id and a.artwork_date=e.entry_date) loop
    perform public.close_day_for(r.user_id, r.entry_date); n := n+1;
  end loop;
  return n;
end;
$$;
-- SKIP LOCKED + token fencing prevents concurrent workers from finishing each other's jobs.
create function public.claim_artwork(p_id uuid default null) returns setof public.daily_artworks language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.daily_artworks set status='failed', error_message='생성이 중단됐어요. 다시 시도 횟수를 모두 사용했어요.' where status='processing' and claimed_at < now()-interval '10 minutes' and attempts>=3;
  select a.id into v_id from public.daily_artworks a join public.profiles p on p.id=a.user_id
    where (p_id is null or a.id=p_id) and p.ai_consent_at is not null and a.attempts<3 and
    (a.status='queued' or (a.status='processing' and a.claimed_at < now()-interval '10 minutes'))
    order by a.created_at for update of a skip locked limit 1;
  if v_id is null then return; end if;
  return query update public.daily_artworks set status='processing', attempts=attempts+1, claimed_at=now(), claim_token=gen_random_uuid(), error_message=null where id=v_id returning *;
end;
$$;
revoke all on function public.handle_new_user(), public.add_entry(text), public.remove_entry(uuid), public.close_day_for(uuid,date), public.close_day(date), public.retry_artwork(uuid), public.enqueue_closed_days(), public.claim_artwork(uuid) from public, anon, authenticated;
grant execute on function public.add_entry(text), public.remove_entry(uuid), public.close_day(date), public.retry_artwork(uuid) to authenticated;
grant execute on function public.close_day_for(uuid,date), public.enqueue_closed_days(), public.claim_artwork(uuid) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('artworks', 'artworks', false, 10485760, array['image/png', 'image/webp']) on conflict(id) do nothing;
create policy artwork_owner_read on storage.objects for select to authenticated using (bucket_id='artworks' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
