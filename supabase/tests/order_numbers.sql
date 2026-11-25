-- Run only on an isolated migrated database; all fixtures roll back.
begin;
do $$
declare b uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); oid uuid; n integer; last integer;
begin
 insert into public.businesses(id,name,slug) values(b,'Number test','number-'||b),(other,'Other number test','number-'||other);
 insert into public.orders(business_id,order_number) values(b,9999) returning id,order_number into oid,n;
 if n<>1001 then raise exception 'caller controlled number'; end if;
 insert into public.orders(business_id) values(other) returning order_number into n;
 if n<>1001 then raise exception 'counter leaked between businesses'; end if;
 update public.orders set status='confirmed' where id=oid;
 if (select order_number from public.orders where id=oid)<>1001 then raise exception 'status changed number'; end if;
 begin
   update public.orders set order_number=1200 where id=oid;
   raise exception 'number changed' using errcode='XX001';
 exception when raise_exception then
   if sqlerrm<>'order_number_immutable' then raise; end if;
 end;
 begin
   update public.orders set business_id=other where id=oid;
   raise exception 'tenant moved' using errcode='XX001';
 exception when raise_exception then
   if sqlerrm<>'order_number_immutable' then raise; end if;
 end;
 -- A duplicate insert must leave the existing identity and number intact.
 insert into public.orders(id,business_id) values(oid,b) on conflict(id) do nothing;
 if (select order_number from public.orders where id=oid)<>1001 then raise exception 'replay changed number'; end if;
 select last_number into last from public.order_number_counters where business_id=b;
 delete from public.orders where id=oid;
 insert into public.orders(business_id) values(b) returning order_number into n;
 if n<>last+1 then raise exception 'deleted number reused'; end if;
 if has_table_privilege('authenticated','public.order_number_counters','SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('anon','public.order_number_counters','SELECT,INSERT,UPDATE,DELETE')
   or has_function_privilege('anon','public.assign_order_number()','EXECUTE') then raise exception 'counter exposed'; end if;
 if not (select relrowsecurity from pg_class c where c.oid='public.order_number_counters'::regclass) then raise exception 'RLS missing'; end if;
end $$;
rollback;
