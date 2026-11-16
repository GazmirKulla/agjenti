-- The customer's own channel profile photo, copied into private storage because provider links expire.
-- One file per participant per connection; every conversation with that participant points at it.
alter table public.conversations add column if not exists participant_avatar_path text;
alter table public.conversations add column if not exists participant_avatar_checked_at timestamptz;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('participant-avatars', 'participant-avatars', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
