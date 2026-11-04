-- Synthetic fixtures. Run with conversation_transport.py --extra-sql in its
-- freshly created socket-only cluster; the entire test rolls back.
begin;
do $$ begin
 if inet_server_addr() is not null then raise exception 'isolated local database required'; end if;
end $$;
do $$
declare b uuid:=gen_random_uuid(); foreign_b uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 ids uuid[]; reviewed jsonb; result jsonb; used uuid; extra uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); blocked boolean;
begin
 insert into auth.users(id) values(u),(outsider);
 insert into public.businesses(id,name,slug) values(b,'Removal synthetic',b::text),(foreign_b,'Foreign synthetic',foreign_b::text);
 insert into public.business_users(business_id,user_id,role) values(b,u,'owner'),(foreign_b,outsider,'owner');
 insert into public.products(business_id,name,is_active) select b,'Synthetic '||n,false from generate_series(1,13)n;
 select array_agg(id order by id) into ids from public.products where business_id=b;
 used:=ids[13];
 insert into public.conversations(id,business_id) values(c,b);
 insert into public.conversation_states(conversation_id,business_id,collected) values(c,b,jsonb_build_object('product_id',used));
 reviewed:=public.prepare_product_removal(b,u,ids);
 if jsonb_array_length(reviewed)<>13 or (select count(*) from jsonb_array_elements(reviewed) r where r->>'operation'='archive')<>1 then raise exception 'preflight classification failed'; end if;
 if (select count(*) from public.products where business_id=b)<>13 then raise exception 'preflight wrote data'; end if;
 blocked:=false;
 begin perform public.prepare_product_removal(b,outsider,ids); exception when others then blocked:=sqlerrm='unauthorized'; end;
 if not blocked then raise exception 'foreign actor allowed'; end if;
 blocked:=false;
 begin perform public.prepare_product_removal(foreign_b,outsider,ids); exception when others then blocked:=sqlerrm='invalid_batch_targets'; end;
 if not blocked then raise exception 'foreign targets allowed'; end if;
 blocked:=false;
 begin perform public.prepare_product_removal(b,u,array[ids[1],ids[1]]); exception when others then blocked:=sqlerrm='invalid_batch_targets'; end;
 if not blocked then raise exception 'duplicate targets allowed'; end if;
 -- A late stale row must undo earlier deletions in the same transaction.
 update public.products set updated_at=updated_at+interval '1 second' where id=ids[12];
 blocked:=false;
 begin perform public.execute_product_removal(b,u,reviewed); exception when others then blocked:=sqlerrm='stale_product'; end;
 if not blocked or (select count(*) from public.products where business_id=b)<>13 then raise exception 'stale batch partially executed'; end if;
 reviewed:=public.prepare_product_removal(b,u,ids);
 -- New history after review must not cause an unapproved archive or partial batch.
 update public.conversation_states set collected=jsonb_build_object('products',array[used,ids[12]]) where conversation_id=c;
 blocked:=false;
 begin perform public.execute_product_removal(b,u,reviewed); exception when others then blocked:=sqlerrm='product_has_history'; end;
 if not blocked or (select count(*) from public.products where business_id=b)<>13 then raise exception 'new history partially executed'; end if;
 reviewed:=public.prepare_product_removal(b,u,ids);
 -- Added after review, never included by execution's old scope of 'all'.
 insert into public.products(id,business_id,name,is_active) values(extra,b,'Added after review',false);
 blocked:=false;
 begin perform public.execute_product_removal(b,outsider,reviewed); exception when others then blocked:=sqlerrm='unauthorized'; end;
 if not blocked then raise exception 'revoked/foreign executor allowed'; end if;
 result:=public.execute_product_removal(b,u,reviewed);
 if result<>'{"deleted":11,"archived":2}'::jsonb then raise exception 'incorrect execution result: %',result; end if;
 if not exists(select 1 from public.products where id=extra and archived_at is null) then raise exception 'unreviewed product changed'; end if;
 if (select count(*) from public.products where business_id=b and archived_at is not null)<>2 then raise exception 'history not archived'; end if;
 if (select collected from public.conversation_states where conversation_id=c)<>jsonb_build_object('products',array[used,ids[12]]) then raise exception 'history changed'; end if;
 blocked:=false;
 begin perform public.execute_product_removal(b,u,reviewed); exception when others then blocked:=sqlerrm='stale_product'; end;
 if not blocked then raise exception 'old reviewed rows replayed'; end if;
 update public.businesses set catalog_source='external' where id=b;
 blocked:=false;
 begin perform public.prepare_product_removal(b,u,array[extra]); exception when others then blocked:=sqlerrm='external_catalog'; end;
 if not blocked then raise exception 'external catalog prepared'; end if;
 if has_function_privilege('authenticated','public.prepare_product_removal(uuid,uuid,uuid[])','execute')
 or has_function_privilege('anon','public.execute_product_removal(uuid,uuid,jsonb)','execute')
 or has_function_privilege('authenticated','public.execute_product_removal(uuid,uuid,jsonb)','execute')
 or has_function_privilege('service_role','public.product_has_history(uuid,uuid)','execute') then raise exception 'unsafe RPC grant'; end if;
end $$;
select 'PASS 13-product review, history classification, tenant checks, stale/new-history atomic rollback, frozen selection, external catalog and ACL';
rollback;
