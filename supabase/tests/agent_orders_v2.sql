-- Agent orders with contract v2 (20261115200000_agent_orders_v2.sql).
-- Run only in an isolated test database after all migrations; everything is rolled back.
begin;
create temp table ids as select gen_random_uuid() as business, gen_random_uuid() as owner, gen_random_uuid() as conversation,
  gen_random_uuid() as puzzle, gen_random_uuid() as plain, gen_random_uuid() as a4, gen_random_uuid() as version;
insert into auth.users(id) select owner from ids;
insert into public.businesses(id,name,slug) select business,'Web Test','web-test-agent-v2' from ids;
insert into public.business_users(business_id,user_id,role) select business,owner,'owner' from ids;
insert into public.conversations(id,business_id) select conversation,business from ids;
-- A product linked to the website: the format is the variant, the color a choice, the character and a photo item details.
insert into public.products(id,business_id,name,price_amount,currency,is_active,source,external_id,external_spec)
 select puzzle,business,'Puzzle me foto',null,'ALL',true,'linked','web-puzzle',jsonb_build_object('version',2,'addons','[]'::jsonb,
  'options',jsonb_build_array(
   jsonb_build_object('key','format','label','Formati','required',true,'affectsPrice',true,'values',jsonb_build_array(jsonb_build_object('id','fmt-a4','name','A4'))),
   jsonb_build_object('key','color','label','Ngjyra','required',true,'affectsPrice',false,'values',jsonb_build_array(jsonb_build_object('id','col-red','name','E kuqe')))),
  'fields',jsonb_build_array(
   jsonb_build_object('key','character','label','Personazhi','type','text','appliesTo','item','required',true),
   jsonb_build_object('key','photo','label','Fotoja','type','photo','appliesTo','item','required',true,'max',2)))
 from ids;
insert into public.product_variants(id,business_id,product_id,options,price_amount,external_id)
 select a4,business,puzzle,'{"format":"A4"}',1500,'web-a4' from ids;
insert into public.products(id,business_id,name,price_amount,currency,is_active) select plain,business,'Kuti',300,'ALL',true from ids;
set local session_replication_role=replica;
insert into public.visual_workflow_versions(id,business_id,graph) select version,business,'{"version":2,"flows":[{"id":"order","productIds":[]}]}' from ids;
set local session_replication_role=origin;

create function pg_temp.fails(sql text, code text) returns void language plpgsql as $$
begin
 begin execute sql; exception when others then
  if sqlerrm<>code then raise exception 'expected % got %',code,sqlerrm; end if; return; end;
 raise exception 'expected % but it succeeded: %',code,sql;
end $$;
-- The agent's reviewed order, awaiting staff, with the customer's answers.
create function pg_temp.review(p_product uuid, p_name text, unit numeric, answers jsonb, rev integer) returns uuid language plpgsql as $$
declare a uuid:=gen_random_uuid(); i ids;
begin
 select * into i from ids;
 insert into public.conversation_states(conversation_id,business_id,revision,collected) values(i.conversation,i.business,rev,jsonb_build_object(
  'schemaVersion',4,'mode','live','revision',rev,'offers','{}'::jsonb,'focusId',null,'businessId',i.business,'conversationId',i.conversation,'instances',jsonb_build_object('one',jsonb_build_object(
   'definitionId','order','versionId',i.version,'productWorkflow',jsonb_build_object('productId',p_product),
   'action',jsonb_build_object('id',a,'tool','order.create','toolVersion',1,'status','succeeded','output',jsonb_build_object('submissionStatus','awaiting_staff'),
    'approval',jsonb_build_object('waitId','w','expiresAt',(extract(epoch from now())*1000+600000)::bigint),'inputDigest','d',
    'input',jsonb_build_object('productId',p_product,'productName',p_name,'productTypeId','none','unitAmount',unit,'currency','ALL','quantity',1,
     'options',answers::text,'name','Ana Test','phone','+355690000000','address','Rruga 1','city','Tiranë'))))))
 on conflict(conversation_id) do update set revision=excluded.revision,collected=excluded.collected;
 return a;
end $$;
create function pg_temp.submit(a uuid, rev integer, files jsonb default null) returns jsonb language sql as $$
 select public.submit_process_order(i.business,i.conversation,rev,a,i.owner,null,null,files) from ids i
$$;
create function pg_temp.photo() returns jsonb language sql as $$
 select jsonb_build_object('photo',jsonb_build_array(i.business||'/'||i.conversation||'/'||gen_random_uuid()||'.jpg')) from ids i
$$;

-- Without an orders URL the order stays here, with the item's selection saved in the product's keys.
do $$ declare r jsonb; begin
 r:=pg_temp.submit(pg_temp.review((select puzzle from ids),'Puzzle me foto',1500,'{"variant_format":"A4","color":"E kuqe","character":"Elsa"}',1),1);
 if r->>'status'<>'local_only' or (r->>'dispatch')::boolean or r ? 'payload' then raise exception 'no url %',r; end if;
 if (select status from public.orders where id=(r->>'orderId')::uuid)<>'confirmed' then raise exception 'no url order status'; end if;
 if (select selection from public.order_items where order_id=(r->>'orderId')::uuid)
   <>'{"options":{"color":"col-red"},"fields":{"character":"Elsa"},"files":{},"addons":[]}'::jsonb then raise exception 'selection %',
   (select selection from public.order_items where order_id=(r->>'orderId')::uuid); end if;
end $$;

insert into public.integrations(business_id,kind,orders_url) select business,'http','https://web.example.test/orders' from ids;

-- Staff chose the photo: the website gets contract v2 with the website's ids, and no v1 keys.
do $$ declare r jsonb; item jsonb; begin
 r:=pg_temp.submit(pg_temp.review((select puzzle from ids),'Puzzle me foto',1500,'{"variant_format":"A4","color":"e kuqe","character":"Elsa"}',2),2,pg_temp.photo());
 if r->>'status'<>'pending_reconciliation' or not (r->>'dispatch')::boolean then raise exception 'dispatch %',r; end if;
 if r#>>'{payload,version}'<>'2' or r#>>'{payload,source}'<>'agent' or (r#>>'{payload,expectedTotal}')::numeric<>1500
   or r#>>'{payload,customer,name}'<>'Ana Test' then raise exception 'payload %',r->'payload'; end if;
 item:=r#>'{payload,items,0}';
 if item->>'productId'<>'web-puzzle' or item->>'variantId'<>'web-a4' or item->'options'<>'{"format":"fmt-a4","color":"col-red"}'::jsonb
   or item->'fields'<>'{"character":"Elsa"}'::jsonb or jsonb_array_length(item->'files')<>1 or item#>>'{files,0,key}'<>'photo'
   or (item->>'unitAmount')::numeric<>1500 then raise exception 'item %',item; end if;
 if item ?| array['formatId','colorId','character','photoUrls'] then raise exception 'v1 keys %',item; end if;
 if (select status from public.orders where id=(r->>'orderId')::uuid)<>'pending_reconciliation' then raise exception 'dispatch order status'; end if;
end $$;

-- Something the website needs is missing or not one of its values: kept here, with the field.
do $$ declare r jsonb; begin
 r:=pg_temp.submit(pg_temp.review((select puzzle from ids),'Puzzle me foto',1500,'{"variant_format":"A4","color":"E kuqe","character":"Elsa"}',3),3);
 if r->>'status'<>'local_only' or r->>'reason'<>'missing_field' or r->>'field'<>'photo' or r->>'line'<>'1' then raise exception 'missing photo %',r; end if;
 r:=pg_temp.submit(pg_temp.review((select puzzle from ids),'Puzzle me foto',1500,'{"variant_format":"A4","color":"E kuqe"}',4),4,pg_temp.photo());
 if r->>'reason'<>'missing_field' or r->>'field'<>'character' then raise exception 'missing character %',r; end if;
 r:=pg_temp.submit(pg_temp.review((select puzzle from ids),'Puzzle me foto',1500,'{"variant_format":"A4","color":"Blu","character":"Elsa"}',5),5,pg_temp.photo());
 if r->>'status'<>'local_only' or r->>'reason'<>'invalid_field' or r->>'field'<>'color' then raise exception 'invalid color %',r; end if;
end $$;
-- A photo from another conversation is refused by the catalog check; the order stays here.
do $$ declare r jsonb; begin
 r:=pg_temp.submit(pg_temp.review((select puzzle from ids),'Puzzle me foto',1500,'{"variant_format":"A4","color":"E kuqe","character":"Elsa"}',6),6,
  jsonb_build_object('photo',jsonb_build_array((select business from ids)||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'.jpg')));
 if r->>'status'<>'local_only' or r->>'reason'<>'invalid_selection' then raise exception 'foreign photo %',r; end if;
end $$;
-- Files only for declared photo fields.
select pg_temp.fails($$select pg_temp.submit(pg_temp.review((select puzzle from ids),'Puzzle me foto',1500,'{"variant_format":"A4","color":"E kuqe","character":"Elsa"}',7),7,'{"logo":[]}')$$,'invalid_selection');
-- A product the website does not know is never sent with Agjenti's own id.
do $$ declare r jsonb; begin
 r:=pg_temp.submit(pg_temp.review((select plain from ids),'Kuti',300,'{}',8),8);
 if r->>'status'<>'local_only' or r->>'reason'<>'unmapped_product' or r ? 'payload' then raise exception 'unmapped %',r; end if;
end $$;

-- The owner's order goes through the same builder: v2 keys, no v1 keys.
do $$ declare o uuid; r jsonb; i ids; begin
 select * into i from ids;
 o:=public.create_manual_order_lines(i.business,i.owner,i.conversation,jsonb_build_array(jsonb_build_object('productId',i.puzzle,'variantId',i.a4,'quantity',2,
  'selection',jsonb_build_object('options',jsonb_build_object('color','col-red'),'fields',jsonb_build_object('character','Elsa'),
   'files',pg_temp.photo()))),'{"name":"Ana Test","phone":"+355690000000"}',null,'agent-v2-owner-1');
 r:=public.begin_order_dispatch(i.business,i.owner,o);
 if not (r->>'dispatch')::boolean or r#>>'{payload,source}'<>'owner_manual' or r#>'{payload,items,0,options}'<>'{"format":"fmt-a4","color":"col-red"}'::jsonb
   or (r#>>'{payload,items,0,quantity}')::numeric<>2 or (r#>>'{payload,expectedTotal}')::numeric<>3000 then raise exception 'owner %',r; end if;
 if r#>'{payload,items,0}' ?| array['formatId','colorId','character'] then raise exception 'owner v1 keys %',r; end if;
 -- A second call gets the recorded state, never a second permission.
 r:=public.begin_order_dispatch(i.business,i.owner,o);
 if (r->>'dispatch')::boolean then raise exception 'second permission'; end if;
end $$;
select 'agent_orders_v2 ok';
rollback;
