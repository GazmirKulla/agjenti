-- The business's team: an owner invites a person by email with a role (owner or staff). The invitation is
-- a link the owner shares (no email service yet); it is accepted only by a signed-in person whose email is
-- the invited one, before it expires. Owners remove members; a business always keeps at least one owner.
--
-- Additive. Rollback: drop function public.accept_business_member_invitation(text,uuid),
--   public.remove_business_member(uuid,uuid,uuid), public.set_business_member_role(uuid,uuid,uuid,text);
--   drop table public.business_member_invitations;
begin;
set local lock_timeout='5s';

create table if not exists public.business_member_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  role text not null check (role in ('owner','staff')),
  token_hash text not null unique,
  token_ciphertext text not null,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists business_member_invitations_pending on public.business_member_invitations (business_id, email) where status = 'pending';
alter table public.business_member_invitations enable row level security;
revoke all on public.business_member_invitations from public, anon, authenticated;
grant all on public.business_member_invitations to service_role;

create or replace function public.accept_business_member_invitation(p_token_hash text, p_user uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare i public.business_member_invitations; user_email text;
begin
  select * into i from public.business_member_invitations where token_hash = p_token_hash for update;
  if not found or i.status <> 'pending' then raise exception 'invitation_unavailable'; end if;
  if i.expires_at <= now() then raise exception 'invitation_expired'; end if;
  -- Only a confirmed email can claim it: signing up with someone's address is not enough.
  select lower(btrim(email)) into user_email from auth.users where id = p_user and email_confirmed_at is not null;
  if user_email is distinct from i.email then raise exception 'invitation_email_mismatch'; end if;
  insert into public.profiles(id, email) values (p_user, user_email) on conflict (id) do nothing;
  -- An existing member keeps the higher role.
  insert into public.business_users(business_id, user_id, role) values (i.business_id, p_user, i.role)
    on conflict (business_id, user_id) do update set role = case when public.business_users.role = 'owner' then 'owner' else excluded.role end;
  update public.business_member_invitations set status = 'accepted', accepted_by = p_user, accepted_at = now() where id = i.id;
  return i.business_id;
end $$;

create or replace function public.remove_business_member(p_business uuid, p_user uuid, p_member uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform 1 from public.businesses where id = p_business for update;
  if not (exists(select 1 from public.business_users where business_id = p_business and user_id = p_user and role = 'owner')
    or exists(select 1 from public.platform_admins where user_id = p_user)) then raise exception 'unauthorized'; end if;
  if exists(select 1 from public.business_users where business_id = p_business and user_id = p_member and role = 'owner')
    and (select count(*) from public.business_users where business_id = p_business and role = 'owner') <= 1 then raise exception 'last_owner'; end if;
  delete from public.business_users where business_id = p_business and user_id = p_member;
  return found;
end $$;

create or replace function public.set_business_member_role(p_business uuid, p_user uuid, p_member uuid, p_role text) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_role not in ('owner','staff') then raise exception 'invalid_role'; end if;
  perform 1 from public.businesses where id = p_business for update;
  if not (exists(select 1 from public.business_users where business_id = p_business and user_id = p_user and role = 'owner')
    or exists(select 1 from public.platform_admins where user_id = p_user)) then raise exception 'unauthorized'; end if;
  if p_role = 'staff' and exists(select 1 from public.business_users where business_id = p_business and user_id = p_member and role = 'owner')
    and (select count(*) from public.business_users where business_id = p_business and role = 'owner') <= 1 then raise exception 'last_owner'; end if;
  update public.business_users set role = p_role where business_id = p_business and user_id = p_member;
  return found;
end $$;

revoke all on function public.accept_business_member_invitation(text,uuid), public.remove_business_member(uuid,uuid,uuid),
  public.set_business_member_role(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.accept_business_member_invitation(text,uuid), public.remove_business_member(uuid,uuid,uuid),
  public.set_business_member_role(uuid,uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;
