-- Private, per-user invalidations. Business state stays behind the existing APIs.
-- Deliberately no entity ids, message bodies, tokens or actor details in payloads.
begin;
set local lock_timeout = '5s';

create policy agjenti_receive_updates on realtime.messages for select to authenticated
using (extension = 'broadcast' and topic = 'updates:' || (select auth.uid())::text
  and realtime.topic() = 'updates:' || (select auth.uid())::text);
-- No client INSERT policy: clients cannot publish authoritative invalidations.

create function public.notify_ui_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  row_data jsonb;
  previous jsonb;
  business uuid;
  business_slug text;
  owner_id uuid;
  recipient uuid;
  resource text := TG_ARGV[0];
begin
  row_data := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  if TG_OP = 'UPDATE' then
    previous := to_jsonb(OLD);
    -- Reads and lease heartbeats must not turn invalidations into a feedback loop.
    if (row_data - array['updated_at','last_seen_at','last_opened_at','leased_until','lease_token'])
       is not distinct from (previous - array['updated_at','last_seen_at','last_opened_at','leased_until','lease_token']) then return null; end if;
  end if;
  business := nullif(row_data->>'business_id','')::uuid;
  if TG_TABLE_NAME = 'businesses' then business := (row_data->>'id')::uuid; end if;
  if TG_TABLE_NAME = 'assistant_conversations' then owner_id := (row_data->>'owner_user_id')::uuid; end if;
  if TG_TABLE_NAME = 'business_attention_events' then owner_id := (row_data->>'user_id')::uuid; end if;
  if TG_TABLE_NAME in ('assistant_messages','assistant_plan_snapshots') then
    select c.business_id,c.owner_user_id into business,owner_id from public.assistant_conversations c where c.id=(row_data->>'conversation_id')::uuid;
  elsif TG_TABLE_NAME = 'workflow_inbound_queue' and row_data->>'operation_kind' in ('test','panel') then
    owner_id := (row_data->>'operator_user_id')::uuid;
  elsif TG_TABLE_NAME = 'conversations' then
    owner_id := nullif(row_data->>'panel_user_id','')::uuid;
  elsif TG_TABLE_NAME in ('messages','conversation_states') then
    select c.business_id,c.panel_user_id into business,owner_id from public.conversations c where c.id=(row_data->>'conversation_id')::uuid;
  end if;
  if TG_TABLE_NAME = 'prospect_scans' then
    perform realtime.send('{}'::jsonb,'changed','internal:prospect:' || (row_data->>'id'),true);
  elsif TG_TABLE_NAME in ('workflow_inbound_queue','marketing_campaign_recipients','marketing_preference_events','booking_customer_messages')
    and row_data->>'connection_id' is not null and row_data->>'participant_id' is not null then
    perform realtime.send('{}'::jsonb,'changed','internal:transport:' || (row_data->>'connection_id') || ':' || (row_data->>'participant_id'),true);
  end if;
  if business is null then return null; end if;
  select b.slug into business_slug from public.businesses b where b.id=business;
  -- Re-evaluate recipients for EVERY write. A revoked member receives no future
  -- business hints, even if a previously authorized socket stays connected.
  for recipient in
    select bu.user_id from public.business_users bu where bu.business_id=business and (owner_id is null or bu.user_id=owner_id)
    union select pa.user_id from public.platform_admins pa where owner_id is null or pa.user_id=owner_id
  loop
    perform realtime.send(jsonb_strip_nulls(jsonb_build_object('resource',resource,'slug',business_slug)),'changed','updates:' || recipient::text,true);
  end loop;
  if TG_TABLE_NAME = 'business_users' and TG_OP <> 'INSERT' then
    perform realtime.send(jsonb_build_object('resource','access'),'changed','updates:' || OLD.user_id::text,true);
  end if;
  return null;
exception when others then
  -- Realtime is not part of the business write's success condition. Persist a
  -- code-only failure while allowing the authoritative mutation to commit.
  insert into public.capability_events(agent,capability,point,outcome,reason,mode,business_id)
    values('system','system.realtime','failed','failure','broadcast:' || SQLSTATE,'live',(select id from public.businesses where id=business));
  return null;
end $$;
revoke all on function public.notify_ui_change() from public,anon,authenticated,service_role;

do $$
declare item record;
begin
  for item in select * from (values
    ('conversations','inbox'),('messages','inbox'),('conversation_states','inbox'),
    ('conversation_profiles','inbox'),('customers','inbox'),
    ('workflow_inbound_queue','transport'),('message_reactions','reactions'),('message_reaction_operations','reactions'),
    ('assistant_conversations','assistant'),('assistant_messages','assistant'),('assistant_plan_snapshots','assistant'),
    ('business_discovery','discovery'),('business_discovery_jobs','discovery'),('business_source_previews','discovery'),
    ('business_intelligence','discovery'),('knowledge_entries','discovery'),('business_onboarding','discovery'),
    ('conversation_training_sessions','training'),
    ('marketing_preference_events','campaigns'),('booking_customer_messages','business'),('marketing_campaigns','campaigns'),('marketing_campaign_recipients','campaigns'),
    ('businesses','business'),('business_setup','business'),('business_users','access'),
    ('orders','business'),('order_submissions','business'),('bookings','business'),('products','business'),
    ('prospect_scans','discovery'),('instagram_connections','business'),('whatsapp_connections','business'),('business_attention_events','assistant')
  ) as targets(table_name,resource)
  loop
    execute format('create trigger notify_ui_change after insert or update or delete on public.%I for each row execute function public.notify_ui_change(%L)',item.table_name,item.resource);
  end loop;
end $$;
commit;
