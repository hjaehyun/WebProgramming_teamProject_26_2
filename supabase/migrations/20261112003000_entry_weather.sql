begin;
-- Additive: weather at the moment a fragment was written (KMA lookup done by the API server).
-- Existing rows keep both columns NULL. Coordinates are never stored; only the weather word and
-- the temperature are kept. The artwork snapshot (close_day_for) selects content/created_at only,
-- so these columns do not reach the image-generation input.
alter table public.entries add column weather_code text
  check (weather_code in ('clear','cloudy','overcast','rain','rain_snow','snow','shower'));
alter table public.entries add column temp_c numeric(4,1)
  check (temp_c between -60 and 60);
alter table public.entries add constraint entries_weather_pair
  check ((weather_code is null) = (temp_c is null));

-- Attaches the weather to the caller's own fragment, once. Only today's fragment (Seoul date) can
-- receive it, so past days cannot be rewritten. Content, date and timestamp are untouched.
-- The existing entries_active_owner trigger still blocks accounts that are being deleted.
create function public.set_entry_weather(p_id uuid, p_code text, p_temp numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  if p_code is null or p_temp is null then raise exception '날씨 정보를 확인해 주세요.'; end if;
  update public.entries set weather_code = p_code, temp_c = round(p_temp, 1)
    where id = p_id and user_id = v_user
      and entry_date = (now() at time zone 'Asia/Seoul')::date
      and weather_code is null;
end; $$;

revoke all on function public.set_entry_weather(uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.set_entry_weather(uuid,text,numeric) to authenticated;
commit;
