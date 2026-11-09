-- Message allowance belongs to the person who pays, not to each business.
-- A business has a billing owner (the user who created it); its automatic
-- replies and assistant replies count against that user's plan. Businesses
-- without an owner (created by a platform administrator) keep the previous
-- per-business allowance until an owner joins.

create table if not exists public.account_billing (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 plan text not null default 'free' check(plan in ('free','starter','professional','enterprise')),
 billing_anchor timestamptz,
 extra_messages bigint not null default 0 check(extra_messages>=0),
 check(plan='free' or billing_anchor is not null)
);
create table if not exists public.account_usage (
 user_id uuid not null references public.profiles(id) on delete cascade,
 period_start timestamptz not null,
 period_end timestamptz not null,
 used bigint not null default 0 check(used>=0),
 primary key(user_id,period_start)
);
alter table public.account_billing enable row level security;
alter table public.account_usage enable row level security;
revoke all on public.account_billing,public.account_usage from anon,authenticated;
grant all on public.account_billing,public.account_usage to service_role;

alter table public.businesses add column if not exists billing_user_id uuid references public.profiles(id) on delete set null;
create index if not exists businesses_billing_user on public.businesses(billing_user_id);

-- Existing businesses: the first owner pays.
update public.businesses b set billing_user_id = o.user_id
from (select distinct on (business_id) business_id, user_id from public.business_users
      where role='owner' order by business_id, created_at, user_id) o
where o.business_id=b.id and b.billing_user_id is null;

insert into public.account_billing(user_id, plan, billing_anchor, extra_messages)
select b.billing_user_id,
  (array['free','starter','professional','enterprise'])[max(array_position(array['free','starter','professional','enterprise'], bb.plan))],
  max(bb.billing_anchor), coalesce(sum(bb.extra_messages),0)
from public.businesses b join public.business_billing bb on bb.business_id=b.id
where b.billing_user_id is not null
group by b.billing_user_id
on conflict (user_id) do nothing;
update public.account_billing set billing_anchor=now() where plan<>'free' and billing_anchor is null;

-- Carry this month's free-plan usage over to the payer.
insert into public.account_usage(user_id, period_start, period_end, used)
select b.billing_user_id, u.period_start, max(u.period_end), sum(u.used)
from public.business_usage u join public.businesses b on b.id=u.business_id
where b.billing_user_id is not null
  and u.period_start = date_trunc('month', now() at time zone 'Europe/Tirane') at time zone 'Europe/Tirane'
group by b.billing_user_id, u.period_start
on conflict (user_id, period_start) do nothing;

-- New owners of an ownerless business become its billing owner.
create or replace function public.assign_business_billing_owner() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.role='owner' then
  update businesses set billing_user_id=new.user_id where id=new.business_id and billing_user_id is null;
  insert into account_billing(user_id) values(new.user_id) on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists assign_business_billing_owner on public.business_users;
create trigger assign_business_billing_owner after insert on public.business_users
 for each row execute function public.assign_business_billing_owner();

-- The previous per-business calculation stays for ownerless businesses.
CREATE OR REPLACE FUNCTION public.business_level_allowance(p_business uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b business_billing; starts timestamptz; ends timestamptz; months integer; amount bigint; consumed bigint; held bigint; extra_held bigint;
begin
 select * into b from business_billing where business_id=p_business for update;
 if not found then raise exception 'billing_unavailable'; end if;
 if b.plan='free' then
  starts:=date_trunc('month',now() at time zone 'Europe/Tirane') at time zone 'Europe/Tirane';
  ends:=(date_trunc('month',now() at time zone 'Europe/Tirane')+interval '1 month') at time zone 'Europe/Tirane';
 else
  months:=greatest(0,((extract(year from now() at time zone 'Europe/Tirane')::integer-extract(year from b.billing_anchor at time zone 'Europe/Tirane')::integer)*12+(extract(month from now() at time zone 'Europe/Tirane')::integer-extract(month from b.billing_anchor at time zone 'Europe/Tirane')::integer)));
  starts:=b.billing_anchor+make_interval(months=>months);
  if starts>now() then
   months:=greatest(0,months-1);
   starts:=b.billing_anchor+make_interval(months=>months);
  end if;
  ends:=b.billing_anchor+make_interval(months=>months+1);
 end if;
 amount:=case b.plan when 'free' then 1000 when 'starter' then 10000 when 'professional' then 50000 else 200000 end;
 insert into business_usage(business_id,period_start,period_end) values(p_business,starts,ends) on conflict do nothing;
 select used into consumed from business_usage where business_id=p_business and period_start=starts;
 -- Uncertain deliveries continue holding a slot, even across renewal.
 select count(*) filter(where bucket='monthly'),count(*) filter(where bucket='extra') into held,extra_held from message_allowance_reservations where business_id=p_business and status='reserved';
 return jsonb_build_object('plan',b.plan,'limit',amount,'used',consumed,'reserved',held,'extra',b.extra_messages,'extraReserved',extra_held,'periodStart',starts,'periodEnd',ends,'available',greatest(0,amount-consumed-held)+greatest(0,b.extra_messages-extra_held));
end $function$;

create or replace function public.account_allowance(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare b account_billing; starts timestamptz; ends timestamptz; months integer; amount bigint; consumed bigint; held bigint; extra_held bigint;
begin
 insert into account_billing(user_id) values(p_user) on conflict do nothing;
 select * into b from account_billing where user_id=p_user for update;
 if b.plan='free' then
  starts:=date_trunc('month',now() at time zone 'Europe/Tirane') at time zone 'Europe/Tirane';
  ends:=(date_trunc('month',now() at time zone 'Europe/Tirane')+interval '1 month') at time zone 'Europe/Tirane';
 else
  months:=greatest(0,((extract(year from now() at time zone 'Europe/Tirane')::integer-extract(year from b.billing_anchor at time zone 'Europe/Tirane')::integer)*12+(extract(month from now() at time zone 'Europe/Tirane')::integer-extract(month from b.billing_anchor at time zone 'Europe/Tirane')::integer)));
  starts:=b.billing_anchor+make_interval(months=>months);
  if starts>now() then months:=greatest(0,months-1); starts:=b.billing_anchor+make_interval(months=>months); end if;
  ends:=b.billing_anchor+make_interval(months=>months+1);
 end if;
 amount:=case b.plan when 'free' then 1000 when 'starter' then 10000 when 'professional' then 50000 else 200000 end;
 insert into account_usage(user_id,period_start,period_end) values(p_user,starts,ends) on conflict do nothing;
 select used into consumed from account_usage where user_id=p_user and period_start=starts;
 select count(*) filter(where r.bucket='monthly'),count(*) filter(where r.bucket='extra') into held,extra_held
  from message_allowance_reservations r join businesses bz on bz.id=r.business_id
  where bz.billing_user_id=p_user and r.status='reserved';
 return jsonb_build_object('scope','account','billingUserId',p_user,'plan',b.plan,'limit',amount,'used',consumed,'reserved',held,
  'extra',b.extra_messages,'extraReserved',extra_held,'periodStart',starts,'periodEnd',ends,
  'available',greatest(0,amount-consumed-held)+greatest(0,b.extra_messages-extra_held));
end $$;

-- Same name and shape as before, so every caller sees the payer's allowance.
create or replace function public.business_allowance(p_business uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
 select billing_user_id into v_user from businesses where id=p_business;
 if not found then raise exception 'billing_unavailable'; end if;
 if v_user is null then return business_level_allowance(p_business) || jsonb_build_object('scope','business'); end if;
 return account_allowance(v_user);
end $$;

create or replace function public.lock_allowance_payer(p_business uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_user uuid;
begin
 select billing_user_id into v_user from businesses where id=p_business;
 if v_user is null then perform 1 from business_billing where business_id=p_business for update;
 else perform 1 from account_billing where user_id=v_user for update; end if;
end $$;

-- One delivered AI message: counted for the payer, and per business for the breakdown.
create or replace function public.count_allowance_use(p_business uuid, p_period timestamptz, p_bucket text) returns void
language plpgsql security definer set search_path=public as $$
declare v_user uuid; v_end timestamptz;
begin
 select billing_user_id into v_user from businesses where id=p_business;
 if v_user is null then
  if p_bucket='monthly' then update business_usage set used=used+1 where business_id=p_business and period_start=p_period;
  else update business_billing set extra_messages=extra_messages-1 where business_id=p_business; end if;
  return;
 end if;
 if p_bucket='monthly' then
  update account_usage set used=used+1 where user_id=v_user and period_start=p_period returning period_end into v_end;
 else
  update account_billing set extra_messages=greatest(0,extra_messages-1) where user_id=v_user;
 end if;
 select period_end into v_end from account_usage where user_id=v_user and period_start=p_period;
 insert into business_usage(business_id,period_start,period_end,used) values(p_business,p_period,coalesce(v_end,p_period+interval '1 month'),1)
  on conflict (business_id,period_start) do update set used=business_usage.used+1;
end $$;

CREATE OR REPLACE FUNCTION public.finish_inbound_workflow_send(p_id bigint, p_token uuid, p_ok boolean, p_external text, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j workflow_inbound_queue; r message_allowance_reservations;
begin
 select * into j from workflow_inbound_queue where id=p_id and lease_token=p_token for update;
 if not found then raise exception 'lease_lost'; end if;
 -- Preserve the outbox receipt contract: the underlying function accepts the
 -- same sent receipt, and rejects a conflicting one without touching usage.
 if j.status='sent' then
  perform finish_workflow_send_before_billing(p_id,p_token,p_ok,p_external,p_error);
  return;
 end if;
 if j.status not in ('sending','uncertain') then
  perform finish_workflow_send_before_billing(p_id,p_token,p_ok,p_external,p_error);
  return;
 end if;
 select * into r from message_allowance_reservations where job_id=p_id and status='reserved';
 if not found then raise exception 'allowance_reservation_missing'; end if;
 perform lock_allowance_payer(j.business_id);
 perform finish_workflow_send_before_billing(p_id,p_token,p_ok,p_external,p_error);
 if p_ok then
  perform count_allowance_use(r.business_id, r.period_start, r.bucket);
  update message_allowance_reservations set status='sent' where job_id=p_id;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_uncertain_allowance(p_id bigint, p_delivered boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r message_allowance_reservations;
begin
 perform 1 from workflow_inbound_queue where id=p_id and status='uncertain' for update;
 if not found then raise exception 'not_uncertain'; end if;
 select * into r from message_allowance_reservations where job_id=p_id and status='reserved' for update;
 if not found then return; end if;
 perform lock_allowance_payer(r.business_id);
 if p_delivered then
  perform count_allowance_use(r.business_id, r.period_start, r.bucket);
 end if;
 update message_allowance_reservations set status=case when p_delivered then 'sent' else 'released' end where job_id=p_id;
end $function$;

-- An assistant reply to the owner is one message, like a reply to a customer.
create or replace function public.consume_assistant_message(p_business uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare a jsonb;
begin
 a:=business_allowance(p_business);
 if (a->>'available')::bigint<=0 then return false; end if;
 perform count_allowance_use(p_business,(a->>'periodStart')::timestamptz,
  case when (a->>'used')::bigint+(a->>'reserved')::bigint<(a->>'limit')::bigint then 'monthly' else 'extra' end);
 return true;
end $$;

revoke all on function public.account_allowance(uuid), public.business_allowance(uuid), public.business_level_allowance(uuid),
  public.lock_allowance_payer(uuid), public.count_allowance_use(uuid,timestamptz,text), public.consume_assistant_message(uuid),
  public.assign_business_billing_owner() from public, anon, authenticated;
grant execute on function public.account_allowance(uuid), public.business_allowance(uuid), public.business_level_allowance(uuid),
  public.lock_allowance_payer(uuid), public.count_allowance_use(uuid,timestamptz,text), public.consume_assistant_message(uuid) to service_role;
