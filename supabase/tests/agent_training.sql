-- Run only in an isolated test database after the migrations. Always rolls back.
begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000091','training-owner@example.test'),('00000000-0000-4000-8000-000000000092','training-other@example.test');
do $$
declare b uuid; other_b uuid; w uuid; other_w uuid; lesson uuid; before_signature text; changed_signature text; original_revision integer;
begin
 perform complete_business_onboarding('00000000-0000-4000-8000-000000000091','{"name":"Training owner","useCases":[]}','Support');
 perform complete_business_onboarding('00000000-0000-4000-8000-000000000092','{"name":"Training other","useCases":[]}','Support');
 select business_id into b from business_users where user_id='00000000-0000-4000-8000-000000000091';
 select business_id into other_b from business_users where user_id='00000000-0000-4000-8000-000000000092';
 insert into workflows(business_id,name) values(b,'Training order') returning id into w;
 insert into workflows(business_id,name) values(other_b,'Other order') returning id into other_w;
 insert into workflow_steps(workflow_id,key,kind,position) values(w,'collect_size','choice',0);
 before_signature:=business_setup_status(b)->>'signature';
 if before_signature<>pre_training_business_setup_status(b)->>'signature' then raise exception 'Untrained business fingerprint changed'; end if;
 insert into business_setup(business_id,tested_signature,tested_at) values(b,before_signature,now()) on conflict(business_id) do update set tested_signature=excluded.tested_signature;
 insert into agent_training_memories(business_id,kind,instruction,created_by,updated_by) values(b,'style','Pa emoji','00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000091') returning id,revision into lesson,original_revision;
 changed_signature:=business_setup_status(b)->>'signature';
 if changed_signature=before_signature or (business_setup_status(b)->>'tested')::boolean then raise exception 'Training did not invalidate setup test'; end if;
 if (business_setup_status(other_b)->>'signature')<>(pre_training_business_setup_status(other_b)->>'signature') then raise exception 'Training affected another tenant'; end if;
 update agent_training_memories set instruction='Shkurt dhe pa emoji' where id=lesson and revision=original_revision;
 if not found or (select revision from agent_training_memories where id=lesson)<>2 then raise exception 'Training revision missing'; end if;
 update agent_training_memories set instruction='Stale' where id=lesson and revision=original_revision;
 if found then raise exception 'Stale edit accepted'; end if;
 update agent_training_memories set is_active=false where id=lesson;
 if business_setup_status(b)->>'signature'<>before_signature then raise exception 'Disabled memory still affects readiness'; end if;
 update agent_training_memories set is_active=true where id=lesson;
 if business_setup_status(b)->>'signature'=before_signature then raise exception 'Re-enabled memory missing'; end if;
 begin
  insert into agent_training_memories(business_id,kind,instruction,workflow_id) values(b,'workflow','Other workflow',other_w);
  raise exception 'Cross-tenant workflow accepted';
 exception when raise_exception then if sqlerrm<>'training_workflow_tenant' then raise; end if; end;
 begin
  insert into agent_training_memories(business_id,kind,instruction,workflow_id,step_key) values(b,'workflow','Invalid step',w,'missing_step');
  raise exception 'Invalid step accepted';
 exception when raise_exception then if sqlerrm<>'training_step_missing' then raise; end if; end;
 insert into agent_training_memories(business_id,kind,instruction,workflow_id,step_key) values(b,'workflow','Explain sizes',w,'collect_size');
 begin
  update agent_training_memories set business_id=other_b where id=lesson;
  raise exception 'Tenant change accepted';
 exception when raise_exception then if sqlerrm<>'training_tenant_immutable' then raise; end if; end;
 delete from agent_training_memories where id=lesson;
 if not exists(select 1 from agent_training_events where memory_id=lesson and operation='DELETE' and before_value->>'instruction'='Shkurt dhe pa emoji') then raise exception 'Deleted lesson audit missing'; end if;
 if (select count(*) from agent_training_events where memory_id=lesson)<>5 then raise exception 'Revision audit missing'; end if;
 update workflow_steps set key='size_updated' where workflow_id=w and key='collect_size';
 if not exists(select 1 from agent_training_memories where workflow_id=w and step_key='size_updated' and revision=2) then raise exception 'Workflow step rename did not adapt training'; end if;
 delete from workflow_steps where workflow_id=w and key='size_updated';
 if exists(select 1 from agent_training_memories where workflow_id=w and step_key is not null) then raise exception 'Deleted workflow step retained training'; end if;
 insert into agent_training_memories(business_id,kind,instruction) values(b,'style','Keep replies concise');
 if has_table_privilege('authenticated','agent_training_memories','insert') or has_table_privilege('authenticated','agent_training_memories','update') or has_table_privilege('authenticated','agent_training_memories','delete') then raise exception 'Direct training write exposed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000092',true);
do $$ begin
 if exists(select 1 from agent_training_memories) or exists(select 1 from agent_training_events) then raise exception 'Training RLS leaked another business'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
do $$ begin if not exists(select 1 from agent_training_memories) then raise exception 'Owner cannot read own training'; end if; end $$;
reset role;
rollback;
