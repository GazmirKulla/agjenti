begin;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000081','intelligence@example.test'),('00000000-0000-4000-8000-000000000082','other@example.test');
do $$
declare u uuid:='00000000-0000-4000-8000-000000000081'; b uuid; rev integer; draft jsonb; entities jsonb; base jsonb;
begin
 perform complete_business_onboarding(u,'{"name":"Test","useCases":[],"details":{"businessDescription":"Studio fotografike"}}','Instructions');
 select business_id into b from business_users where user_id=u;
 if not exists(select 1 from business_intelligence where business_id=b) then raise exception 'Onboarding bridge failed'; end if;
 if not exists(select 1 from business_intelligence bi, jsonb_array_elements(bi.data->'entities') e, jsonb_array_elements(e->'facts') f where bi.business_id=b and f->>'field'='description' and f->>'value'='Studio fotografike') then raise exception 'Onboarding details lost';end if;
 base:=intelligence_snapshot(b);
 entities:='[{"id":"00000000-0000-4000-8000-000000000091","target":"product","facts":[{"field":"name","value":"Puzzle"},{"field":"price","value":"25"},{"field":"currency","value":"EUR"}]},{"id":"00000000-0000-4000-8000-000000000092","target":"workflow","facts":[{"field":"name","value":"Foto përpara adresës"},{"field":"steps","value":"photo|Foto\ncustomer|Adresa"}]},{"id":"00000000-0000-4000-8000-000000000093","target":"service","facts":[{"field":"name","value":"Konsultim"},{"field":"description","value":"30 minuta"}]}]';
 draft:=jsonb_build_object('entities',entities,'conflicts','[]'::jsonb);
 -- The draft as the source scans leave it (they write business_intelligence themselves).
 update business_intelligence set data=draft, baseline=base where business_id=b returning revision into rev;
 if exists(select 1 from products where business_id=b) then raise exception 'Draft changed catalog';end if;
 rev:=apply_intelligence(b,u,rev,draft,entities);
 if not exists(select 1 from products where business_id=b and name='Puzzle' and price_amount=25 and is_active=false) then raise exception 'Product failed';end if;
 if not exists(select 1 from workflow_steps where workflow_id='00000000-0000-4000-8000-000000000092' and position=0 and kind='photo') then raise exception 'Steps failed';end if;
 if not exists(select 1 from knowledge_entries where business_id=b and intent_key='service') then raise exception 'Service failed';end if;
 -- Retrying an applied request cannot duplicate anything.
 begin perform apply_intelligence(b,u,rev-1,draft,entities);raise exception 'Retry allowed' using errcode='XX001';exception when raise_exception then if sqlerrm<>'stale_draft' then raise;end if;end;
 update products set name='Manual correction' where business_id=b;
 begin perform apply_intelligence(b,u,rev,draft,entities);raise exception 'Overwrote newer platform' using errcode='XX001';exception when raise_exception then if sqlerrm<>'platform_changed' then raise;end if;end;
 if has_function_privilege('authenticated','public.apply_intelligence(uuid,uuid,integer,jsonb,jsonb)','execute') then raise exception 'RPC publicly exposed';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
do $$ begin if exists(select 1 from business_intelligence) or exists(select 1 from business_intelligence_sources) then raise exception 'Cross tenant read';end if;end $$;
reset role;
rollback;
