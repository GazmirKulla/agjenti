-- Messages the business sends from the native Instagram / WhatsApp Business app
-- (provider echoes). Stored as outbound 'staff' rows; sent_via marks the origin.
-- Apply BEFORE deploying the code that selects messages.sent_via.
begin;
alter table public.messages add column sent_via text
  check (sent_via is null or sent_via in ('instagram_app','whatsapp_app'));
commit;
