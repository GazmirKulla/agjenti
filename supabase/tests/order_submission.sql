-- W4: ONLY on an isolated database, AFTER the migration has been approved/applied.
-- Not executed as part of Vitest. Rolls back all fixtures, including fault injection.
begin;
\ir fixtures/order_readiness.sql
create function pg_temp.reject_test_order_item() returns trigger language plpgsql as $$
begin
  if new.options->>'size'='FAIL_ITEM' then raise exception 'test_item_insert_failure'; end if;
  return new;
end $$;
create trigger w4_test_item_failure before insert on public.order_items
  for each row execute function pg_temp.reject_test_order_item();

do $$
declare
  b uuid:=gen_random_uuid(); other_b uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  c uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); foreign_p uuid:=gen_random_uuid(); review_id uuid:=gen_random_uuid();
  product_type uuid:=gen_random_uuid(); foreign_customer uuid:=gen_random_uuid();
  state jsonb; changed jsonb; r jsonb; again jsonb; oid uuid; blocked boolean;
begin
  insert into auth.users(id,email) values(actor,'w4@test.invalid'),(outsider,'w4-other@test.invalid');
  insert into businesses(id,name,slug,dashboard_profile) values(b,'W4','w4-'||b::text,'{"version":1,"source":"manual","enabledModules":["orders","products","workflows"]}'),
    (other_b,'W4 other','w4-'||other_b::text,null);
  insert into business_users(business_id,user_id,role) values(b,actor,'owner');
  insert into conversations(id,business_id,channel,whatsapp_participant_id) values(c,b,'whatsapp','w4-customer');
  insert into product_types(id,name,external_key,is_active) values(product_type,'Global W4 type','w4-'||product_type::text,true);
  insert into products(id,business_id,name,price_amount,currency,is_active,product_type_id) values(p,b,'Product',19.5,'EUR',true,product_type),(foreign_p,other_b,'Foreign',19.5,'EUR',true,null);
  insert into customers(id,business_id,display_name) values(foreign_customer,other_b,'Foreign customer');
  state:=jsonb_build_object('schemaVersion',3,'product_id',p,'product_type_id',product_type,'step_key','order_ready',
    'customer',jsonb_build_object('name','Ana','phone','+355691234567','address','Rruga A','city','Tirane'),
    'visual',jsonb_build_object('versionId','immutable-pin'),
    'fields',jsonb_build_object('size','M'),
    'context',jsonb_build_object('execution',jsonb_build_object('factOwner','order','orderConfirmed',true,
      'orderTerms',jsonb_build_object('productId',p,'unitAmount',19.5,'currency','EUR','quantity',1),
      'orderReview',jsonb_build_object('id',review_id,'confirmed',true,'factsKey','server-verified-facts','fieldKeys',jsonb_build_array('size'),'expiresAt',extract(epoch from now()+interval '30 minutes')*1000))));
  state:=pg_temp.pin_test_order(b,actor,state);
  insert into conversation_states(conversation_id,business_id,collected,revision) values(c,b,state,7);
  if has_function_privilege('authenticated','public.submit_confirmed_order(uuid,uuid,uuid,integer,jsonb,jsonb,boolean)','execute')
    or has_function_privilege('authenticated','public.finish_order_submission(uuid,uuid,uuid,text,text)','execute')
    or has_table_privilege('authenticated','public.order_submissions','insert') then raise exception 'Client can forge intent'; end if;
  blocked:=false; begin perform submit_confirmed_order(b,outsider,c,7,state,state,false); exception when others then blocked:=sqlerrm='unauthorized'; end;
  if not blocked then raise exception 'Cross-tenant actor accepted'; end if;
  blocked:=false; begin perform submit_confirmed_order(other_b,actor,c,7,state,state,false); exception when others then blocked:=sqlerrm='unauthorized'; end;
  if not blocked then raise exception 'Foreign business accepted'; end if;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,6,state,state,false); exception when others then blocked:=sqlerrm='stale_state'; end;
  if not blocked then raise exception 'Stale revision accepted'; end if;
  changed:=jsonb_set(state,'{customer,phone}','"+355699999999"');
  update conversation_states set collected=changed where conversation_id=c;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,state,state,false); exception when others then blocked:=sqlerrm='stale_state'; end;
  if not blocked then raise exception 'Legacy write without revision bypassed equality fence'; end if;
  update conversation_states set collected=state where conversation_id=c;
  changed:=jsonb_set(state,'{context,execution,orderReview,expiresAt}','1');
  update conversation_states set collected=changed where conversation_id=c;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,changed,changed,false); exception when others then blocked:=sqlerrm='confirmation_required'; end;
  if not blocked then raise exception 'Expired confirmation accepted'; end if;
  update conversation_states set collected=state where conversation_id=c;
  update products set currency='USD' where id=p;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,state,state,false); exception when others then blocked:=sqlerrm='commercial_terms_changed'; end;
  if not blocked then raise exception 'Currency mismatch accepted'; end if;
  update products set currency='EUR',is_active=false where id=p;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,state,state,false); exception when others then blocked:=sqlerrm='product_unavailable'; end;
  if not blocked then raise exception 'Inactive product accepted'; end if;
  update products set is_active=true where id=p;
  update product_types set is_active=false where id=product_type;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,state,state,false); exception when others then blocked:=sqlerrm='product_unavailable'; end;
  if not blocked then raise exception 'Inactive global type accepted'; end if;
  update product_types set is_active=true where id=product_type;
  changed:=jsonb_set(state,'{product_id}',to_jsonb(foreign_p));
  update conversation_states set collected=changed where conversation_id=c;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,changed,changed,false); exception when others then blocked:=sqlerrm='product_unavailable'; end;
  if not blocked then raise exception 'Foreign product accepted'; end if;
  update conversation_states set collected=state where conversation_id=c;
  update businesses set dashboard_profile=jsonb_set(dashboard_profile,'{enabledModules}','["products"]') where id=b;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,state,state,false); exception when others then blocked:=sqlerrm='module_disabled'; end;
  if not blocked then raise exception 'Explicit module deactivation bypassed'; end if;
  update businesses set dashboard_profile=jsonb_set(dashboard_profile,'{enabledModules}','["products","orders","workflows"]') where id=b;
  delete from business_users where business_id=b and user_id=actor;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,state,state,false); exception when others then blocked:=sqlerrm='unauthorized'; end;
  if not blocked then raise exception 'Revoked actor accepted'; end if;
  insert into business_users(business_id,user_id,role) values(b,actor,'owner');
  -- S1 rejects the invalid relationship before the order RPC can observe it.
  blocked:=false; begin update conversations set customer_id=foreign_customer where id=c;
  exception when foreign_key_violation then blocked:=true; end;
  if not blocked or (select customer_id from conversations where id=c) is not null
    then raise exception 'Cross-tenant customer accepted or failed write persisted'; end if;
  update conversation_states set cart='[{"quantity":2}]' where conversation_id=c;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,state,state,false); exception when others then blocked:=sqlerrm='unsupported_order_scope'; end;
  if not blocked then raise exception 'Multi-item cart flattened'; end if;
  update conversation_states set cart='[]' where conversation_id=c;

  -- Fault AFTER order/CRM insert: every change must roll back.
  changed:=jsonb_set(state,'{fields,size}','"FAIL_ITEM"');
  update conversation_states set collected=changed where conversation_id=c;
  blocked:=false; begin perform submit_confirmed_order(b,actor,c,7,changed,changed,false); exception when others then blocked:=sqlerrm='test_item_insert_failure'; end;
  if not blocked then raise exception 'Item fault did not abort'; end if;
  if exists(select 1 from orders where business_id=b) or exists(select 1 from order_submissions where business_id=b)
    or exists(select 1 from customers where business_id=b) or (select customer_id from conversations where id=c) is not null
    then raise exception 'Partial order/customer persisted'; end if;
  update conversation_states set collected=state where conversation_id=c;
  r:=submit_confirmed_order(b,actor,c,7,state,state,false); oid:=(r->>'orderId')::uuid;
  if r->>'dispatch'<>'true' or r#>>'{payload,channel}'<>'whatsapp' or r#>>'{payload,currency}'<>'EUR'
    or (r#>>'{payload,items,0,unitAmount}')::numeric<>19.5 then raise exception 'Authoritative payload incorrect'; end if;
  if (select count(*) from order_items where order_id=oid)<>1 or (select status from orders where id=oid)<>'pending_reconciliation'
    then raise exception 'Order not durably pending with item'; end if;
  if (select collected from conversation_states where conversation_id=c) is distinct from state then raise exception 'Pinned snapshot mutated'; end if;
  -- Same receipt with the OLD revision returns only the existing order, never dispatch.
  again:=submit_confirmed_order(b,actor,c,7,state,state,false);
  if again->>'orderId'<>r->>'orderId' or again->>'dispatch'<>'false' or (select count(*) from orders where business_id=b)<>1
    then raise exception 'Sequential replay created/sent twice'; end if;
  -- Authenticated legacy table writes cannot remove or edit the managed order/items.
  perform set_config('request.jwt.claim.role','authenticated',true);
  blocked:=false; begin update orders set total_amount=0 where id=oid; exception when others then blocked:=sqlerrm='managed_order_immutable'; end;
  if not blocked then raise exception 'Direct order edit bypassed ledger'; end if;
  blocked:=false; begin delete from order_items where order_id=oid; exception when others then blocked:=sqlerrm='managed_order_immutable'; end;
  if not blocked then raise exception 'Direct item deletion bypassed ledger'; end if;
  perform set_config('request.jwt.claim.role','',true);
  blocked:=false; begin perform reconcile_order_submission(b,actor,c,oid,'accepted','ext-1','Verified at provider support reference 123'); exception when others then blocked:=sqlerrm='submission_in_flight'; end;
  if not blocked then raise exception 'In-flight reconciliation accepted'; end if;
  update order_submissions set created_at=now()-interval '2 minutes' where order_id=oid;
  blocked:=false; begin perform reconcile_order_submission(b,outsider,c,oid,'accepted','ext-1','Verified at provider support reference 123'); exception when others then blocked:=sqlerrm='unauthorized'; end;
  if not blocked then raise exception 'Foreign actor reconciled order'; end if;
  blocked:=false; begin perform reconcile_order_submission(b,actor,c,oid,'accepted','ext-1',''); exception when others then blocked:=sqlerrm='reconciliation_evidence_required'; end;
  if not blocked then raise exception 'Evidence-free reconciliation accepted'; end if;
  perform reconcile_order_submission(b,actor,c,oid,'accepted','ext-1','Verified at provider support reference 123');
  if (select status from orders where id=oid)<>'submitted' or (select reconciled_by from order_submissions where order_id=oid)<>actor
    then raise exception 'Reconciliation not audited'; end if;
  blocked:=false; begin perform finish_order_submission(b,oid,(r->>'attemptId')::uuid,'rejected',null); exception when others then blocked:=sqlerrm='result_conflict'; end;
  if not blocked then raise exception 'Late response overwrote resolved result'; end if;
end $$;
rollback;
