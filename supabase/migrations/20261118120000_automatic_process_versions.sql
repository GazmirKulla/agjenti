-- Automatic process: for a business without a workflow of its own, the server builds the customer
-- process from its modules and settings (orders, order status, bookings, staff handoff). Each built
-- graph is kept as an immutable row of visual_workflow_versions, so running conversations stay on their
-- version and the order and booking functions verify it exactly as they verify a published workflow.
--
-- * visual_workflow_versions.automatic: marks rows the server built; the owner's version history and
--   restore never list them.
-- * ensure_automatic_process_version: stores one built graph under its content-derived id, once. The id
--   is computed by the server from the business and the graph; a different graph under the same id is
--   refused. It never touches visual_workflows: the owner's draft, published version and switch stay theirs.
--
-- Rollback: drop the function, then the column (automatic rows can stay; they are ordinary versions).
begin;
set local lock_timeout='5s';

alter table public.visual_workflow_versions add column if not exists automatic boolean not null default false;

create or replace function public.ensure_automatic_process_version(p_business uuid, p_id uuid, p_graph jsonb)
 returns uuid language plpgsql security definer set search_path=public as $$
declare existing visual_workflow_versions;
begin
 if p_business is null or p_id is null or not public.valid_visual_graph(p_graph, true) or p_graph->>'version' is distinct from '2'
  or exists(select 1 from jsonb_array_elements(p_graph->'nodes') n where n->>'kind'='action') then raise exception 'invalid_automatic_process'; end if;
 if not exists(select 1 from businesses where id=p_business) then raise exception 'invalid_automatic_process'; end if;
 select * into existing from visual_workflow_versions where id=p_id;
 if found then
  if existing.business_id<>p_business or not existing.automatic or existing.graph<>p_graph then raise exception 'automatic_process_conflict'; end if;
  return existing.id;
 end if;
 insert into visual_workflow_versions(id, business_id, graph, created_by, automatic) values(p_id, p_business, p_graph, null, true)
  on conflict (id) do nothing;
 select * into existing from visual_workflow_versions where id=p_id;
 if existing.business_id<>p_business or not existing.automatic or existing.graph<>p_graph then raise exception 'automatic_process_conflict'; end if;
 return existing.id;
end $$;

revoke all on function public.ensure_automatic_process_version(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ensure_automatic_process_version(uuid, uuid, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
