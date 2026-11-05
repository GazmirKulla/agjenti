-- Only in a disposable socket-only *_w4_test database. All data rolls back.
begin;
\ir fixtures/order_readiness.sql
do $$ begin
 if current_database() not like '%\_w4\_test' escape '\' or inet_server_addr() is not null then raise exception 'isolated database required'; end if;
 if has_function_privilege('authenticated','public.submit_agent_confirmed_order(uuid,uuid,integer,jsonb,jsonb)','execute')
 or has_function_privilege('service_role','public.submit_confirmed_order_internal(uuid,uuid,uuid,integer,jsonb,jsonb,boolean,boolean)','execute')
 or has_table_privilege('authenticated','public.business_automation_policies','update') then raise exception 'unexpected privilege'; end if;
end $$;
create temp table config_fixture as select gen_random_uuid() b,gen_random_uuid() actor,gen_random_uuid() outsider,gen_random_uuid() c,gen_random_uuid() p,null::jsonb state;
grant select on config_fixture to service_role;
do $$ declare f record; s jsonb; begin
 select * into f from config_fixture;
 insert into auth.users(id,email) values(f.actor,f.actor||'@test.invalid'),(f.outsider,f.outsider||'@test.invalid');
 insert into public.businesses(id,name,slug,auto_reply) values(f.b,'Synthetic configuration','configuration-'||f.b,true);
 insert into public.business_users(business_id,user_id,role) values(f.b,f.actor,'owner');
 insert into public.products(id,business_id,name,price_amount,currency,is_active) values(f.p,f.b,'Synthetic product',12.75,'EUR',true);
 insert into public.conversations(id,business_id,auto_reply) values(f.c,f.b,true);
 s:=jsonb_build_object('schemaVersion',3,'product_id',f.p,'step_key','order_ready','fields','{}'::jsonb,
 'customer',jsonb_build_object('name','Synthetic customer','phone','+355691234567','address','Test only'),
 'context',jsonb_build_object('execution',jsonb_build_object('factOwner','order','orderConfirmed',true,
 'orderTerms',jsonb_build_object('productId',f.p,'unitAmount',12.75,'currency','EUR','quantity',1),
 'orderReview',jsonb_build_object('id',gen_random_uuid(),'confirmed',true,'factsKey','server-test','fieldKeys','[]'::jsonb,'expiresAt',4102444800000))));
 s:=pg_temp.pin_test_order(f.b,f.actor,s);
 insert into public.conversation_states(conversation_id,business_id,collected,revision) values(f.c,f.b,s,7);
 update config_fixture set state=s;
end $$;
set local role service_role;
do $$ declare f record; r jsonb; again jsonb; blocked boolean; begin
 select * into f from config_fixture;
 blocked:=false;
 begin perform public.submit_agent_confirmed_order(f.b,f.c,7,f.state,f.state);
 exception when others then if sqlerrm<>'automation_not_authorized' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'unconfigured automation executed'; end if;
 blocked:=false;
 begin perform public.configure_business_automation(f.b,f.outsider,true,0);
 exception when others then if sqlerrm<>'unauthorized' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'outsider configured'; end if;
 perform public.configure_business_automation(f.b,f.actor,true,0);
 blocked:=false;
 begin perform public.configure_business_automation(f.b,f.actor,false,0);
 exception when others then if sqlerrm<>'stale_policy' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'stale configuration accepted'; end if;
 blocked:=false;
 begin perform public.submit_agent_confirmed_order(f.b,f.c,8,f.state,f.state);
 exception when others then if sqlerrm<>'stale_state' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'stale order accepted'; end if;
 r:=public.submit_agent_confirmed_order(f.b,f.c,7,f.state,f.state);
 if r->>'status' is distinct from 'local_only' or r->>'dispatch' is distinct from 'false' then raise exception 'local order dispatched externally'; end if;
 again:=public.submit_agent_confirmed_order(f.b,f.c,7,f.state,f.state);
 if again->>'orderId' is distinct from r->>'orderId' or (select count(*) from public.orders where business_id=f.b)<>1 then raise exception 'duplicate order'; end if;
 if not exists(select 1 from public.order_submissions where business_id=f.b and created_by is null and executor_kind='customer_agent' and status='local_only') then raise exception 'actor audit incorrect'; end if;
 perform public.configure_business_automation(f.b,f.actor,false,1);
 blocked:=false;
 begin perform public.submit_agent_confirmed_order(f.b,f.c,7,f.state,f.state);
 exception when others then if sqlerrm<>'automation_not_authorized' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'revoked policy ignored'; end if;
 raise notice 'PASS local-only automation, owner policy, revision fences, idempotency and actor audit';
end $$;
rollback;
