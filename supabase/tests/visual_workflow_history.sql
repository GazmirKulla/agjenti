begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000004201','history@example.test');
insert into businesses(id,name,slug) values('00000000-0000-4000-8000-000000004201','History','history');
insert into business_users(business_id,user_id,role) values('00000000-0000-4000-8000-000000004201','00000000-0000-4000-8000-000000004201','owner');
do $$ declare a uuid:='00000000-0000-4000-8000-000000004201'; request_id uuid:=gen_random_uuid(); g jsonb:='{"version":1,"name":"Flow","nodes":[{"id":"start","kind":"start","label":"Start","position":{"x":0,"y":0},"config":{}},{"id":"end","kind":"end","label":"End","position":{"x":300,"y":0},"config":{}}],"edges":[{"id":"next","source":"start","target":"end","port":"next"}]}'; begin
 perform apply_assistant_visual_workflow(a,a,0,g,'publish',request_id);
 if apply_assistant_visual_workflow(a,a,0,g,'publish',request_id)<>1 then raise exception 'replay result changed'; end if;
 if (select count(*) from visual_workflow_versions where business_id=a)<>1 then raise exception 'duplicate publication'; end if;
 if (select count(*) from visual_workflow_events where business_id=a)<>1 then raise exception 'duplicate audit'; end if;
 begin perform apply_assistant_visual_workflow(a,a,0,g,'publish',gen_random_uuid()); raise exception 'stale accepted' using errcode='XX001'; exception when raise_exception then if sqlerrm<>'stale_workflow' then raise; end if; end;
 begin perform apply_assistant_visual_workflow(a,a,0,g,'draft',request_id); raise exception 'altered replay accepted' using errcode='XX001'; exception when raise_exception then if sqlerrm<>'invalid_replay' then raise; end if; end;
 perform save_visual_workflow(a,a,1,jsonb_set(g,'{name}','"Editor change"'),'draft');
 if not exists(select 1 from visual_workflow_events where business_id=a and revision=2 and before_data->'draft'->>'name'='Flow' and after_data->'draft'->>'name'='Editor change') then raise exception 'editor audit missing'; end if;
 if has_table_privilege('authenticated','visual_workflow_events','insert') or has_table_privilege('service_role','visual_workflow_events','update') or has_function_privilege('authenticated','apply_assistant_visual_workflow(uuid,uuid,integer,jsonb,text,uuid)','execute') then raise exception 'write boundary exposed'; end if;
end $$;
rollback;
