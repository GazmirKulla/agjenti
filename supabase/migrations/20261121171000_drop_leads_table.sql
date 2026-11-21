-- Step B, after the code that reads conversations.lead_status is deployed: the leads table and its
-- functions go. lead_settings stays on businesses for the follow-up time ("pa përgjigje" after N hours).
begin;
drop function if exists public.manage_lead(uuid, uuid, uuid, text, text);
drop function if exists public.save_lead_settings(uuid, uuid, jsonb);
drop table if exists public.leads;
commit;
