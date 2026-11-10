-- A scan read publicly by username has no Instagram connection to check when
-- it finishes (the connection check stays for scans through a connection).
begin;

CREATE OR REPLACE FUNCTION public.finish_business_discovery(p_job uuid, p_lease uuid, p_revision integer, p_draft jsonb, p_signals jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare j business_discovery_jobs;
begin
 select * into j from business_discovery_jobs where id=p_job;
 if not found then return false;end if;
 perform 1 from businesses where id=j.business_id for update;
 select * into j from business_discovery_jobs where id=p_job for update;
 if j.status<>'running' or j.lease_token is distinct from p_lease or j.leased_until<=now() then return false;end if;
 if j.source='instagram' and not (j.input ? 'username') and not exists(select 1 from instagram_connections where business_id=j.business_id and id=(j.input->>'connectionId')::uuid and discovery_generation=(j.input->>'generation')::uuid and status='connected') then raise exception 'connection_changed';end if;
 update business_discovery set draft=p_draft,signals=case when signals_source='manual' then signals else p_signals end,revision=revision+1,updated_at=now() where business_id=j.business_id and revision=p_revision;
 if not found then return false;end if;
 insert into business_intelligence_sources(business_id,user_id,source,reference,transcript,extracted,status)
 values(j.business_id,j.user_id,j.source,coalesce(j.checkpoint->>'reference','discovery:'||j.id),j.checkpoint->>'text',j.checkpoint->'entities','completed');
 update business_discovery_jobs set status='completed',stage='done',lease_token=null,leased_until=null,error=null,updated_at=now() where id=p_job;
 return true;
end $function$;

commit;
