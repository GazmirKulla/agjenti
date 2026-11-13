-- Platform settings of the "Mëso nga bisedat" tool (minimum conversations,
-- messages per conversation, scan size, period, Instagram history).
-- The code reads defaults while this column is missing.
begin;
alter table public.app_settings add column conversation_learning jsonb not null default '{}'::jsonb;
commit;
