-- Paying for a plan with POK. The payer saves a card once (POK keeps the card,
-- Agjenti keeps only its POK id and a masked label) and pays each month with
-- it, passing 3-D Secure. A paid plan lasts until paid_until; afterwards the
-- account returns to Free. Plans set by an administrator (paid_until null)
-- keep working as before.

alter table public.account_billing add column if not exists paid_until timestamptz;

create table if not exists public.account_payment_cards (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 pok_card_id text not null,
 label text not null,
 environment text not null check(environment in ('staging','production')),
 created_at timestamptz not null default now()
);

create table if not exists public.billing_payments (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 plan text not null check(plan in ('starter','professional','enterprise')),
 amount numeric(12,2) not null check(amount>0),
 currency text not null,
 environment text not null check(environment in ('staging','production')),
 pok_order_id text unique,
 status text not null default 'pending' check(status in ('pending','paid','failed')),
 period_start timestamptz,
 period_end timestamptz,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create index if not exists billing_payments_user on public.billing_payments(user_id, created_at desc);

alter table public.account_payment_cards enable row level security;
alter table public.billing_payments enable row level security;
revoke all on public.account_payment_cards, public.billing_payments from anon, authenticated;
grant all on public.account_payment_cards, public.billing_payments to service_role;

-- Records a payment POK confirmed. Idempotent: the webhook and the browser may
-- both report the same payment. Paying the current plan again before it ends
-- adds the next month; any other payment starts a new month from now.
create or replace function public.apply_billing_payment(p_payment uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p billing_payments; b account_billing; starts timestamptz; ends timestamptz; n integer;
begin
 select * into p from billing_payments where id=p_payment for update;
 if not found then raise exception 'payment_not_found'; end if;
 if p.status='paid' then
  return jsonb_build_object('applied',false,'periodStart',p.period_start,'periodEnd',p.period_end);
 end if;
 insert into account_billing(user_id) values(p.user_id) on conflict do nothing;
 select * into b from account_billing where user_id=p.user_id for update;
 if b.plan=p.plan and b.paid_until is not null and b.paid_until>now() and b.billing_anchor is not null then
  -- Same anchor, so the message period keeps its renewal day.
  starts:=b.paid_until;
  n:=1;
  while b.billing_anchor+make_interval(months=>n)<=b.paid_until loop n:=n+1; end loop;
  ends:=b.billing_anchor+make_interval(months=>n);
  update account_billing set paid_until=ends where user_id=p.user_id;
 else
  starts:=now();
  ends:=starts+interval '1 month';
  update account_billing set plan=p.plan, billing_anchor=starts, paid_until=ends where user_id=p.user_id;
 end if;
 update billing_payments set status='paid', paid_at=now(), period_start=starts, period_end=ends where id=p.id;
 return jsonb_build_object('applied',true,'periodStart',starts,'periodEnd',ends);
end $$;

-- Same as before, plus: a paid plan whose paid time has ended returns to Free.
create or replace function public.account_allowance(p_user uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare b account_billing; starts timestamptz; ends timestamptz; months integer; amount bigint; consumed bigint; held bigint; extra_held bigint;
begin
 insert into account_billing(user_id) values(p_user) on conflict do nothing;
 select * into b from account_billing where user_id=p_user for update;
 if b.plan<>'free' and b.paid_until is not null and b.paid_until<=now() then
  update account_billing set plan='free', billing_anchor=null, paid_until=null where user_id=p_user returning * into b;
 end if;
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
  'extra',b.extra_messages,'extraReserved',extra_held,'periodStart',starts,'periodEnd',ends,'paidUntil',b.paid_until,
  'available',greatest(0,amount-consumed-held)+greatest(0,b.extra_messages-extra_held));
end $$;

revoke all on function public.apply_billing_payment(uuid), public.account_allowance(uuid) from public, anon, authenticated;
grant execute on function public.apply_billing_payment(uuid), public.account_allowance(uuid) to service_role;
