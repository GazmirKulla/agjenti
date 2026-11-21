-- The business's logo, shown in the panel instead of its initials. Copied from the connected
-- Instagram account's profile photo (provider links expire, so the file is stored here) or
-- uploaded by the owner; an uploaded logo is never replaced by Instagram.
alter table public.businesses add column if not exists logo_url text;
alter table public.businesses add column if not exists logo_source text check (logo_source in ('instagram', 'manual'));
alter table public.businesses add column if not exists logo_checked_at timestamptz;

-- Public: a logo is the business's public face. Writes go only through the server (service role)
-- under the business's own folder; there are no client storage policies.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
