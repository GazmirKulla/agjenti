-- Real chat (ChatLab panel conversations) creates and updates leads like an Instagram or WhatsApp chat.
-- Only the channel filter changes; the rest is the live definition.
CREATE OR REPLACE FUNCTION public.track_lead_from_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare conv conversations; matched text; settings jsonb;
begin
 begin
  select * into conv from conversations where id = new.conversation_id;
  if conv.id is null or conv.channel not in ('instagram','whatsapp','panel') then return new; end if;
  if new.direction = 'outbound' and new.source = 'staff' then
   update leads set status = 'contacted', status_changed_at = now(), updated_at = now()
    where business_id = new.business_id and conversation_id = conv.id and status = 'new'
      and coalesce((select (lead_settings->>'autoContacted')::boolean from businesses where id = new.business_id), true);
   return new;
  end if;
  if new.direction <> 'inbound' or new.source <> 'customer' then return new; end if;
  if conv.customer_id is not null and exists(select 1 from customers where id = conv.customer_id and archived_at is not null) then return new; end if;
  select lead_settings into settings from businesses where id = new.business_id;
  matched := lead_rule_match(coalesce(settings,'{}'::jsonb), new.body);
  if matched is null then return new; end if;
  insert into leads(business_id, customer_id, conversation_id, source, interest, last_interest_at)
   values(new.business_id, conv.customer_id, conv.id, matched, left(btrim(new.body), 500), new.created_at)
   on conflict (business_id, conversation_id) where status in ('new','contacted') and conversation_id is not null
   do update set last_interest_at = excluded.last_interest_at, interest = excluded.interest,
     customer_id = coalesce(excluded.customer_id, leads.customer_id), updated_at = now();
 exception when others then
  raise warning 'lead tracking failed: %', sqlerrm;
 end;
 return new;
end $function$;
