-- Isolated database only; no real tenants are changed.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000002101','slug1@example.test'),
 ('00000000-0000-4000-8000-000000002102','slug2@example.test'),
 ('00000000-0000-4000-8000-000000002103','slug3@example.test');
do $$
declare
 a jsonb := '{"name":"Filiz Slug Test","useCases":[]}';
 b uuid;
 s text;
begin
 if public.business_slug_base('Lulëzimi i Çuditshëm') <> 'lulezimi-i-cuditshem' then raise exception 'Accent normalization failed'; end if;
 if public.business_slug_base('!!!') <> 'biznes' then raise exception 'Fallback missing'; end if;
 s := public.complete_business_onboarding('00000000-0000-4000-8000-000000002101',a,'Instructions');
 if s <> 'filiz-slug-test' then raise exception 'Name slug missing: %',s; end if;
 if public.complete_business_onboarding('00000000-0000-4000-8000-000000002102',a,'Instructions') <> 'filiz-slug-test-1' then raise exception 'Must start incrementing at -1'; end if;
 if public.complete_business_onboarding('00000000-0000-4000-8000-000000002103',a,'Instructions') <> 'filiz-slug-test-2' then raise exception 'Second suffix missing'; end if;
 if public.complete_business_onboarding('00000000-0000-4000-8000-000000002101',a,'Retry') <> s then raise exception 'Retry changed address'; end if;
 -- Stale application-side allocation is resolved atomically by the insert.
 insert into public.businesses(name,slug) values('Filiz Slug Test',s) returning slug into s;
 if s <> 'filiz-slug-test-3' then raise exception 'Admin insert collision not resolved'; end if;
 insert into public.businesses(name,slug) values('Custom Name','explicit-custom-address') returning id into b;
 insert into public.business_slug_aliases(slug,business_id) values('reserved-address',b);
 begin
   insert into public.businesses(name,slug) values('Another Name','reserved-address');
   raise exception 'Reserved alias was reused' using errcode='XX001';
 exception when unique_violation then null;
 end;
 insert into public.businesses(name,slug) values('Reserved Address','reserved-address') returning slug into s;
 if s <> 'reserved-address-1' then raise exception 'Automatic allocation reused alias'; end if;
 delete from public.businesses where id=b;
 if exists(select 1 from public.business_slug_aliases where business_id=b) then raise exception 'Alias did not cascade on deletion'; end if;
 -- Deleted workspaces may restart onboarding, and the first free number wins.
 delete from public.businesses where slug='filiz-slug-test-1';
 if public.complete_business_onboarding('00000000-0000-4000-8000-000000002102',a,'Restart') <> 'filiz-slug-test-1' then raise exception 'Orphan restart or first free suffix failed'; end if;
 if has_table_privilege('authenticated','public.business_slug_aliases','select')
   or has_function_privilege('anon','public.allocate_business_slug(text)','execute') then raise exception 'Alias enumeration/allocation exposed'; end if;
 if not has_function_privilege('service_role','public.allocate_business_slug(text)','execute') then raise exception 'Service role missing privilege'; end if;
end $$;
rollback;
