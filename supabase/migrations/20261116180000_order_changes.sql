-- Staff change the delivery details or the note of an order that already exists (phase 1 of
-- order changes). The business website decides whether its order can still change; Agjenti keeps
-- every change with its values before and after.
--
-- * order_changes: one row per requested change. change_id is the client's request id and is sent to
--   the website as X-Agjenti-Change-Id, so a repeated request never changes the order twice.
-- * begin_order_change checks membership and the values, and:
--   - for an order that is only in Agjenti, applies the change at once (status accepted);
--   - for an order on the business website, records it as pending; the server then asks the website
--     and calls finish_order_change with the answer.
--   The same change_id again returns the same row; an uncertain (or stale pending) one is handed back
--   for sending again with the same id. Another change of the same order waits until that one ends.
-- * finish_order_change applies an accepted change to orders.payload and the customer record
--   (apply_order_contact), or records the refusal / the uncertain result.
--
-- Requires 20261116150000_order_contact_rule.sql. Rollback: drop the two functions and the table.
begin;

create table if not exists public.order_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  change_id uuid not null unique,
  source text not null default 'owner' check (source in ('owner','agent')),
  requested_by uuid,
  external boolean not null,
  before jsonb not null,
  changes jsonb not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected','uncertain')),
  error text check (error is null or char_length(error) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_changes_order on public.order_changes(order_id, created_at desc);
create unique index if not exists order_changes_one_open on public.order_changes(order_id) where status in ('pending','uncertain');
alter table public.order_changes enable row level security;
revoke all on public.order_changes from public, anon, authenticated;
grant select, insert, update on public.order_changes to service_role;

-- What a change may contain: the delivery fields (name, phone, city, address) and the note.
-- Returns the normalized change; raises invalid_change.
create or replace function public.order_change_values(p_changes jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare out jsonb:='{}'::jsonb; c jsonb; k text; v text; limits jsonb:='{"name":120,"phone":40,"city":120,"address":300}';
begin
 if jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text) > 4000
   or exists(select 1 from jsonb_object_keys(p_changes) x where x not in ('customer','note')) then raise exception 'invalid_change'; end if;
 if p_changes ? 'customer' then
  c:=p_changes->'customer';
  if jsonb_typeof(c) is distinct from 'object' or exists(select 1 from jsonb_object_keys(c) x where not limits ? x) then raise exception 'invalid_change'; end if;
  for k in select jsonb_object_keys(c) loop
   if jsonb_typeof(c->k) not in ('string','null') then raise exception 'invalid_change'; end if;
   v:=nullif(btrim(c->>k),'');
   if v is not null and char_length(v) > (limits->>k)::int then raise exception 'invalid_change'; end if;
   -- The website needs a name and a phone to deliver.
   if v is null and k in ('name','phone') then raise exception 'customer_required'; end if;
   if k='name' and char_length(v) < 2 then raise exception 'customer_required'; end if;
   out:=jsonb_set(out, array['customer'], coalesce(out->'customer','{}'::jsonb) || jsonb_build_object(k, v));
  end loop;
 end if;
 if p_changes ? 'note' then
  if jsonb_typeof(p_changes->'note') not in ('string','null') then raise exception 'invalid_change'; end if;
  v:=nullif(btrim(p_changes->>'note'),'');
  if v is not null and char_length(v) > 1000 then raise exception 'invalid_change'; end if;
  out:=out || jsonb_build_object('note', v);
 end if;
 return out;
end $$;

-- The order's payload with a change applied (only the keys the change names).
create or replace function public.order_change_apply(p_payload jsonb, p_changes jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case when p_changes ? 'customer'
   then jsonb_set(coalesce(p_payload,'{}'::jsonb), '{customer}', coalesce(p_payload->'customer','{}'::jsonb) || (p_changes->'customer'))
   else coalesce(p_payload,'{}'::jsonb) end
  || case when p_changes ? 'note' then jsonb_build_object('note', p_changes->'note') else '{}'::jsonb end
$$;

create or replace function public.finish_order_change(p_business uuid, p_change uuid, p_status text, p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ch order_changes; o orders;
begin
 if p_status not in ('accepted','rejected','uncertain') then raise exception 'invalid_status'; end if;
 select * into ch from order_changes where change_id=p_change and business_id=p_business for update;
 if not found then raise exception 'change_not_found'; end if;
 -- A result arrives once; a settled change never moves again.
 if ch.status not in ('pending','uncertain') then return to_jsonb(ch); end if;
 if p_status='accepted' then
  select * into o from orders where id=ch.order_id and business_id=p_business for update;
  update orders set payload=order_change_apply(o.payload, ch.changes), updated_at=now() where id=o.id;
  if ch.changes ? 'customer' and o.customer_id is not null then
   perform apply_order_contact(p_business, o.customer_id, ch.changes#>>'{customer,name}', ch.changes#>>'{customer,phone}');
  end if;
 end if;
 update order_changes set status=p_status, error=left(p_error,120), updated_at=now() where id=ch.id returning * into ch;
 return to_jsonb(ch);
end $$;

create or replace function public.begin_order_change(p_business uuid, p_user uuid, p_order uuid, p_change uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o orders; ch order_changes; open_change order_changes; vals jsonb; before jsonb; is_external boolean;
begin
 if not exists(select 1 from business_users where business_id=p_business and user_id=p_user)
  and not exists(select 1 from platform_admins where user_id=p_user) then raise exception 'unauthorized'; end if;
 if p_change is null then raise exception 'invalid_change'; end if;
 select * into ch from order_changes where change_id=p_change;
 if found then
  if ch.business_id<>p_business or ch.order_id<>p_order then raise exception 'change_conflict'; end if;
  -- The same request again: an uncertain (or long-pending) change is sent again with the same id.
  if ch.status='uncertain' or ch.status='pending' and ch.updated_at < now()-interval '2 minutes' then
   update order_changes set status='pending', updated_at=now() where id=ch.id returning * into ch;
   select * into o from orders where id=ch.order_id and business_id=p_business;
   return to_jsonb(ch) || jsonb_build_object('send', true, 'externalOrderId', o.external_order_id);
  end if;
  return to_jsonb(ch) || jsonb_build_object('send', false);
 end if;
 vals:=order_change_values(p_changes);
 select * into o from orders where id=p_order and business_id=p_business for update;
 if not found then raise exception 'order_not_found'; end if;
 -- An order whose sending is still unverified is not changed until staff settle it.
 if o.status='pending_reconciliation' then raise exception 'order_unsettled'; end if;
 select * into open_change from order_changes where order_id=o.id and status in ('pending','uncertain') limit 1;
 if found then raise exception 'change_in_progress'; end if;
 before:=jsonb_build_object('customer', coalesce(o.payload->'customer','{}'::jsonb), 'note', o.payload->'note');
 if order_change_apply(o.payload, vals) = o.payload then raise exception 'no_change'; end if;
 is_external:=o.external_system='external' and o.external_order_id is not null;
 insert into order_changes(business_id, order_id, change_id, source, requested_by, external, before, changes)
  values(p_business, o.id, p_change, 'owner', p_user, is_external, before, vals) returning * into ch;
 if not is_external then
  return finish_order_change(p_business, p_change, 'accepted') || jsonb_build_object('send', false);
 end if;
 return to_jsonb(ch) || jsonb_build_object('send', true, 'externalOrderId', o.external_order_id);
end $$;

revoke all on function public.order_change_values(jsonb) from public, anon, authenticated;
revoke all on function public.order_change_apply(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.finish_order_change(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.begin_order_change(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.order_change_values(jsonb) to service_role;
grant execute on function public.order_change_apply(jsonb, jsonb) to service_role;
grant execute on function public.finish_order_change(uuid, uuid, text, text) to service_role;
grant execute on function public.begin_order_change(uuid, uuid, uuid, uuid, jsonb) to service_role;

commit;
