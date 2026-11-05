-- Restore delivery-receipt fields required by the staff outbox status endpoint
-- and begin_workflow_send / finish_workflow_send. Some deployed schemas lack
-- these columns despite having the functions from the transport migrations.
-- Existing rows remain untouched; do not fabricate historical receipts.
alter table public.workflow_inbound_queue
  add column if not exists provider_message_id text,
  add column if not exists send_started_at timestamptz;

notify pgrst, 'reload schema';
