-- Usage alerts for the person who pays: when the monthly messages reach 80%,
-- 95% and 100% (and when extra messages run out), the assistant writes to them
-- once in a "Mesazhet e paketës" conversation. The message is of kind 'notice',
-- which also queues a push notification to their phone. The text only informs:
-- store builds of the mobile app never point to plans; the web adds the button.
begin;

create table if not exists public.account_usage_alerts (
 user_id uuid not null references public.profiles(id) on delete cascade,
 period_start timestamptz not null,
 level text not null check(level in ('80','95','100','extra')),
 business_id uuid references public.businesses(id) on delete set null,
 conversation_id uuid,
 created_at timestamptz not null default now(),
 primary key(user_id,period_start,level)
);
alter table public.account_usage_alerts enable row level security;
revoke all on public.account_usage_alerts from anon,authenticated;
grant all on public.account_usage_alerts to service_role;

alter table public.assistant_messages drop constraint if exists assistant_messages_kind_check;
alter table public.assistant_messages add constraint assistant_messages_kind_check
  check (kind in ('user','assistant','backend_outcome','interrupted','onboarding','notice'));

-- Writes one alert, at most once per person, period and level.
create or replace function public.write_usage_alert(p_user uuid, p_business uuid, p_period timestamptz, p_level text)
returns void language plpgsql security definer set search_path=public as $$
declare b account_billing; u account_usage; amount bigint; plan_name text; body text; conv uuid; c assistant_conversations;
begin
 insert into account_usage_alerts(user_id,period_start,level,business_id) values(p_user,p_period,p_level,p_business)
  on conflict do nothing;
 if not found then return; end if;
 select * into b from account_billing where user_id=p_user;
 select * into u from account_usage where user_id=p_user and period_start=p_period;
 amount:=case b.plan when 'free' then 1000 when 'starter' then 10000 when 'professional' then 50000 else 200000 end;
 plan_name:=case b.plan when 'free' then 'Free' when 'starter' then 'Starter' when 'professional' then 'Professional' else 'Enterprise' end;
 body:=case p_level
  when '80' then format('Ke përdorur 80%% të mesazheve AI të paketës %s (%s nga %s këtë muaj). Mesazhet vlejnë për të gjitha bizneset e tua.',
    plan_name, replace(to_char(u.used,'FM999,999,990'),',',' '), replace(to_char(amount,'FM999,999,990'),',',' '))
  when '95' then format('Të kanë mbetur pak mesazhe: ke përdorur 95%% të paketës %s (%s nga %s). Kur mbarojnë, përgjigjet automatike te klientët dhe asistenti ndalen deri në rinovim më %s.',
    plan_name, replace(to_char(u.used,'FM999,999,990'),',',' '), replace(to_char(amount,'FM999,999,990'),',',' '), to_char(u.period_end at time zone 'Europe/Tirane','DD.MM.YYYY'))
  when '100' then case when coalesce(b.extra_messages,0)>0
    then format('Mesazhet mujore të paketës %s mbaruan. Tani po përdoren %s mesazhet shtesë.',
      plan_name, replace(to_char(b.extra_messages,'FM999,999,990'),',',' '))
    else format('Mesazhet e paketës %s mbaruan. Përgjigjet automatike te klientët dhe asistenti janë ndalur deri në rinovim më %s.',
      plan_name, to_char(u.period_end at time zone 'Europe/Tirane','DD.MM.YYYY')) end
  else 'Mesazhet shtesë mbaruan. Përgjigjet automatike te klientët dhe asistenti janë ndalur deri në rinovimin e paketës.'
 end;
 -- One conversation per person, business and period.
 conv:=md5('usage-alerts:'||p_user||':'||p_business||':'||p_period)::uuid;
 insert into assistant_conversations(id,business_id,owner_user_id,title) values(conv,p_business,p_user,'Mesazhet e paketës')
  on conflict(id) do nothing;
 select * into c from assistant_conversations where id=conv for update;
 if c.deleted_at is not null or c.owner_user_id<>p_user then return; end if;
 insert into assistant_messages(conversation_id,seq,request_id,role,kind,content)
  values(conv,c.message_seq+1,gen_random_uuid(),'assistant','notice',body);
 update assistant_conversations set message_seq=c.message_seq+1,revision=revision+1,updated_at=clock_timestamp() where id=conv;
 update account_usage_alerts set conversation_id=conv where user_id=p_user and period_start=p_period and level=p_level;
end $$;

-- Same counting as before, plus the alerts when a threshold is crossed.
create or replace function public.count_allowance_use(p_business uuid, p_period timestamptz, p_bucket text)
returns void language plpgsql security definer set search_path=public as $$
declare v_user uuid; v_end timestamptz; v_used bigint; v_plan text; v_extra bigint; amount bigint;
begin
 select billing_user_id into v_user from businesses where id=p_business;
 if v_user is null then
  if p_bucket='monthly' then update business_usage set used=used+1 where business_id=p_business and period_start=p_period;
  else update business_billing set extra_messages=extra_messages-1 where business_id=p_business; end if;
  return;
 end if;
 if p_bucket='monthly' then
  update account_usage set used=used+1 where user_id=v_user and period_start=p_period returning used into v_used;
 else
  update account_billing set extra_messages=greatest(0,extra_messages-1) where user_id=v_user returning extra_messages into v_extra;
 end if;
 select period_end into v_end from account_usage where user_id=v_user and period_start=p_period;
 insert into business_usage(business_id,period_start,period_end,used) values(p_business,p_period,coalesce(v_end,p_period+interval '1 month'),1)
  on conflict (business_id,period_start) do update set used=business_usage.used+1;
 -- Alerts never block counting: a failure here only loses the message, not the use.
 begin
  if p_bucket='monthly' and v_used is not null then
   select plan into v_plan from account_billing where user_id=v_user;
   amount:=case v_plan when 'free' then 1000 when 'starter' then 10000 when 'professional' then 50000 else 200000 end;
   if v_used>=amount then perform write_usage_alert(v_user,p_business,p_period,'100');
   elsif v_used*100>=amount*95 then perform write_usage_alert(v_user,p_business,p_period,'95');
   elsif v_used*100>=amount*80 then perform write_usage_alert(v_user,p_business,p_period,'80');
   end if;
  elsif p_bucket='extra' and v_extra=0 then
   perform write_usage_alert(v_user,p_business,p_period,'extra');
  end if;
 exception when others then
  raise warning 'usage alert failed: %', sqlerrm;
 end;
end $$;

-- Notices also reach the phone.
create or replace function public.queue_mobile_assistant_notification()
returns trigger language plpgsql security definer set search_path=public as $$
declare event uuid; owner_id uuid; business uuid;
begin
 if new.role <> 'assistant' or new.kind not in ('assistant','backend_outcome','interrupted','notice') then return new; end if;
 select owner_user_id,business_id into owner_id,business from assistant_conversations where id=new.conversation_id and deleted_at is null;
 if owner_id is null then return new; end if;
 insert into mobile_notification_events(user_id,business_id,conversation_id,message_seq,kind)
 values(owner_id,business,new.conversation_id,new.seq,new.kind)
 on conflict(conversation_id,message_seq) do nothing returning id into event;
 if event is not null then
  insert into mobile_notification_deliveries(event_id,token) select event,token from mobile_devices where user_id=owner_id;
 end if;
 return new;
end $$;

revoke all on function public.write_usage_alert(uuid,uuid,timestamptz,text), public.count_allowance_use(uuid,timestamptz,text) from public, anon, authenticated;
grant execute on function public.write_usage_alert(uuid,uuid,timestamptz,text), public.count_allowance_use(uuid,timestamptz,text) to service_role;

commit;
