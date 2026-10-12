begin;

-- The payer and allowance belong to the business, never to a membership.
create table public.business_billing (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 plan text not null default 'free' check(plan in ('free','starter','professional','enterprise')),
 billing_anchor timestamptz,
 extra_messages bigint not null default 0 check(extra_messages>=0),
 check(plan='free' or billing_anchor is not null)
);
create table public.business_usage (
 business_id uuid references public.businesses(id) on delete cascade,
 period_start timestamptz not null,
 period_end timestamptz not null,
 used bigint not null default 0 check(used>=0),
 primary key(business_id,period_start)
);
create table public.message_allowance_reservations (
 job_id bigint primary key references public.workflow_inbound_queue(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 period_start timestamptz not null,
 bucket text not null check(bucket in ('monthly','extra')),
 status text not null default 'reserved' check(status in ('reserved','sent','released'))
);
create index message_allowance_open on public.message_allowance_reservations(business_id,period_start) where status='reserved';
alter table public.business_billing enable row level security;
alter table public.business_usage enable row level security;
alter table public.message_allowance_reservations enable row level security;
-- No client writes or direct reads: dashboard access is verified on the server.
revoke all on public.business_billing,public.business_usage,public.message_allowance_reservations from anon,authenticated;
grant all on public.business_billing,public.business_usage,public.message_allowance_reservations to service_role;
insert into business_billing(business_id) select id from businesses;
create function public.initialize_business_billing() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into business_billing(business_id) values(new.id); return new; end $$;
create trigger initialize_business_billing after insert on public.businesses for each row execute function public.initialize_business_billing();

create function public.business_allowance(p_business uuid) returns jsonb language plpgsql security definer set search_path=public as $$
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
end $$;

create function public.reserve_workflow_allowance(p_id bigint,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare j workflow_inbound_queue; a jsonb; r message_allowance_reservations;
begin
 select * into j from workflow_inbound_queue where id=p_id and lease_token=p_token and status in ('processing','prepared') and leased_until>now() for update;
 if not found then return false; end if;
 a:=business_allowance(j.business_id);
 select * into r from message_allowance_reservations where job_id=p_id;
 if found and r.status='reserved' then return true; end if;
 if found and r.status='sent' then return false; end if;
 if (a->>'available')::bigint<=0 then
  update workflow_inbound_queue set status='ignored',leased_until=null,error='Monthly message allowance exhausted' where id=p_id;
  return false;
 end if;
 insert into message_allowance_reservations(job_id,business_id,period_start,bucket) values(p_id,j.business_id,(a->>'periodStart')::timestamptz,case when (a->>'used')::bigint+(a->>'reserved')::bigint<(a->>'limit')::bigint then 'monthly' else 'extra' end)
 on conflict(job_id) do update set status='reserved',period_start=excluded.period_start,bucket=excluded.bucket;
 return true;
end $$;

-- Release abandoned processing/prepared work; uncertain sends need verification.
create function public.release_workflow_allowance() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('ignored','failed') then
  update message_allowance_reservations set status='released' where job_id=new.id and status='reserved';
 end if;
 return new;
end $$;
create trigger release_workflow_allowance after update of status on public.workflow_inbound_queue for each row execute function public.release_workflow_allowance();

alter function public.begin_workflow_send(bigint,uuid) rename to begin_workflow_send_before_billing;
create function public.begin_workflow_send(p_id bigint,p_token uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not reserve_workflow_allowance(p_id,p_token) then return false; end if;
 return begin_workflow_send_before_billing(p_id,p_token);
end $$;

alter function public.finish_workflow_send(bigint,uuid,boolean,text,text) rename to finish_workflow_send_before_billing;
create function public.finish_workflow_send(p_id bigint,p_token uuid,p_ok boolean,p_external text,p_error text) returns void language plpgsql security definer set search_path=public as $$
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
 perform 1 from business_billing where business_id=j.business_id for update;
 perform finish_workflow_send_before_billing(p_id,p_token,p_ok,p_external,p_error);
 if p_ok then
  if r.bucket='monthly' then
   update business_usage set used=used+1 where business_id=r.business_id and period_start=r.period_start;
  else
   update business_billing set extra_messages=extra_messages-1 where business_id=r.business_id;
  end if;
  update message_allowance_reservations set status='sent' where job_id=p_id;
 end if;
end $$;

-- Used only after an operator verifies an uncertain provider delivery.
create function public.resolve_uncertain_allowance(p_id bigint,p_delivered boolean) returns void language plpgsql security definer set search_path=public as $$
declare r message_allowance_reservations;
begin
 perform 1 from workflow_inbound_queue where id=p_id and status='uncertain' for update;
 if not found then raise exception 'not_uncertain'; end if;
 select * into r from message_allowance_reservations where job_id=p_id and status='reserved' for update;
 if not found then return; end if;
 perform 1 from business_billing where business_id=r.business_id for update;
 if p_delivered then
  if r.bucket='monthly' then update business_usage set used=used+1 where business_id=r.business_id and period_start=r.period_start;
  else update business_billing set extra_messages=extra_messages-1 where business_id=r.business_id; end if;
 end if;
 update message_allowance_reservations set status=case when p_delivered then 'sent' else 'released' end where job_id=p_id;
end $$;
revoke all on function public.business_allowance(uuid),public.reserve_workflow_allowance(bigint,uuid),public.begin_workflow_send(bigint,uuid),public.finish_workflow_send(bigint,uuid,boolean,text,text),public.resolve_uncertain_allowance(bigint,boolean),public.initialize_business_billing(),public.release_workflow_allowance(),public.begin_workflow_send_before_billing(bigint,uuid),public.finish_workflow_send_before_billing(bigint,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.business_allowance(uuid),public.reserve_workflow_allowance(bigint,uuid),public.begin_workflow_send(bigint,uuid),public.finish_workflow_send(bigint,uuid,boolean,text,text),public.resolve_uncertain_allowance(bigint,boolean) to service_role;
-- Service workers must use the quota-aware wrappers.
revoke execute on function public.begin_workflow_send_before_billing(bigint,uuid),public.finish_workflow_send_before_billing(bigint,uuid,boolean,text,text) from service_role;
commit;
