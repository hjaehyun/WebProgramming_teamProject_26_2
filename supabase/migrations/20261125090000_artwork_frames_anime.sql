begin;
-- Additive: a frame chosen per picture, drawn by the screens with CSS only. The image file, the
-- generation job and its snapshot are untouched. Existing pictures get the basic frame, which
-- renders exactly as before.
alter table public.daily_artworks add column frame text not null default 'basic'
  check (frame in ('basic','diary','polaroid','wood','tape','sketch'));

-- Pictures stay read-only to their owners (select policy only); the frame changes only here.
-- Returns the stored frame, or null when the caller has no picture on that day. The existing
-- artworks_active_owner trigger still blocks accounts that are being deleted.
create function public.set_artwork_frame(p_date date, p_frame text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_frame text;
begin
  if v_user is null then raise exception '로그인이 필요해요.'; end if;
  update public.daily_artworks set frame = p_frame
    where user_id = v_user and artwork_date = p_date
    returning frame into v_frame;
  return v_frame;
end; $$;

revoke all on function public.set_artwork_frame(date,text) from public,anon,authenticated;
grant execute on function public.set_artwork_frame(date,text) to authenticated;

-- New drawing style 'anime' (the same id on screen and in the database).
alter table public.profiles drop constraint profiles_art_style_check;
alter table public.profiles add constraint profiles_art_style_check
  check (art_style in ('watercolor','pencil','gouache','crayon','story','anime'));
commit;
