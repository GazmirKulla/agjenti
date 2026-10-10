-- Run after the message-runtime migrations. Create these two secrets through
-- Supabase Vault first: agjenti_app_url (production HTTPS origin), and
-- agjenti_cron_secret (the same CRON_SECRET configured in the deployment).
-- Never put their values in this file, migration history or application logs.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare origin text;
begin
 select decrypted_secret into origin from vault.decrypted_secrets where name='agjenti_app_url';
 if origin is null or origin !~ '^https://[^/[:space:]]+/?$' then
  raise exception 'Configure agjenti_app_url in Vault with the production HTTPS origin';
 end if;
 if not exists(select 1 from vault.decrypted_secrets where name='agjenti_cron_secret' and length(decrypted_secret)>0) then
  raise exception 'Configure agjenti_cron_secret in Vault';
 end if;
 perform cron.schedule('agjenti-workflow-inbound','* * * * *', $job$
  select net.http_get(
   url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='agjenti_app_url'),'/') || '/api/cron/workflow-inbound',
   headers := jsonb_build_object('Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='agjenti_cron_secret')),
   timeout_milliseconds := 180000
  );
 $job$);
end $$;
