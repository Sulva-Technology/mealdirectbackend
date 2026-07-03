begin;

-- Private media buckets for vendor logos, menu item images, and user avatars.
-- Reads are served only through short-lived signed read URLs and writes only through
-- signed upload URLs, both minted with the service-role key. No anon or authenticated
-- Storage policies are added, so storage.objects RLS (enabled by Supabase) denies all
-- non-service-role access by default -- the same private posture as
-- public.rider_payout_accounts. file_size_limit and allowed_mime_types add
-- Storage-side defense in depth on top of the API's own content-type/size checks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('vendor-logos', 'vendor-logos', false, 2097152,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('avatars', 'avatars', false, 2097152,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('menu-item-images', 'menu-item-images', false, 5242880,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Documented, read-only surface over the private media buckets for ops/debugging.
create or replace view public.media_buckets as
  select id, name, file_size_limit, allowed_mime_types
  from storage.buckets
  where id in ('vendor-logos', 'avatars', 'menu-item-images');

comment on view public.media_buckets is 'Read-only listing of Meal Direct private media buckets and their Storage-side size/mime limits.';

commit;
