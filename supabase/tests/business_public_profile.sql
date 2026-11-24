-- Synthetic fixtures, rolled back. Runs only against a local database (socket or loopback).
begin;
do $$ begin if inet_server_addr() is not null and host(inet_server_addr()) not in ('127.0.0.1','::1') then raise exception 'local database required'; end if; end $$;
do $$
declare b uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); stamp timestamptz; r jsonb; v bigint; failed text;
 p1 jsonb:='{"version":1,"contacts":{"phone":"+355 69 000 0000"},"hours":{"weekly":[{"day":1,"open":"09:00","close":"17:00"}]}}';
 p2 jsonb:='{"version":1,"contacts":{"phone":"+355 69 000 0000"},"location":{"address":"Rruga e Kavajës 1, Tiranë"},"hours":{"weekly":[{"day":1,"open":"10:00","close":"18:00"}]}}';
begin
 insert into auth.users(id) values(u);
 insert into public.businesses(id,name,slug) values(b,'Profile test',b::text),(other,'Other',other::text);
 insert into public.business_users(business_id,user_id,role) values(b,u,'owner');
 if (select public_profile from public.businesses where id=b)<>'{"version":1}'::jsonb then raise exception 'empty profile is not the default'; end if;
 execute 'set constraints all immediate'; execute 'set constraints all deferred'; perform set_config('agjenti.configuration_seen_'||replace(b::text,'-',''),'',true);
 select coalesce(max(revision),0) into v from public.agent_configuration_snapshots where business_id=b;
 select public_profile_updated_at into stamp from public.businesses where id=b;
 r:=public.apply_agent_configuration(b,u,gen_random_uuid(),v,jsonb_build_array(jsonb_build_object('type','profile.set','profile',p1,'expected',stamp)),'owner','Orari');
 if not (r->>'created')::boolean or (select public_profile from public.businesses where id=b)<>p1 then raise exception 'profile not applied: %',r; end if;
 if (select snapshot->'profile' from public.agent_configuration_snapshots where business_id=b order by revision desc limit 1)<>p1 then raise exception 'profile not in the version'; end if;
 -- A save prepared on the old stamp is refused; nothing changes.
 failed:=null;
 begin perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,jsonb_build_array(jsonb_build_object('type','profile.set','profile',p2,'expected',stamp)),'owner','');
 exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'stale_configuration_target' or (select public_profile from public.businesses where id=b)<>p1 then raise exception 'stale profile save accepted: %',failed; end if;
 -- An invalid shape is refused.
 failed:=null;
 begin perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,'[{"type":"profile.set","profile":{"version":1,"secret":"x"}}]','owner','');
 exception when others then failed:=sqlerrm; end;
 if failed is distinct from 'invalid_configuration_change' then raise exception 'invalid profile accepted: %',failed; end if;
 select public_profile_updated_at into stamp from public.businesses where id=b;
 perform public.apply_agent_configuration(b,u,gen_random_uuid(),null,jsonb_build_array(jsonb_build_object('type','profile.set','profile',p2,'expected',stamp)),'owner','Adresa');
 select max(revision) into v from public.agent_configuration_snapshots where business_id=b;
 -- Rikthe brings the earlier profile back as a new version; another business is untouched.
 r:=public.revert_agent_configuration(b,u,gen_random_uuid(),v,v-1);
 if (select public_profile from public.businesses where id=b)<>p1 or (r->>'revision')::bigint<>v+1 then raise exception 'profile not restored: %',r; end if;
 if (select public_profile from public.businesses where id=other)<>'{"version":1}'::jsonb then raise exception 'other business changed'; end if;
 -- A direct write (another editor) is versioned too.
 update public.businesses set public_profile=p2 where id=b;
 execute 'set constraints all immediate'; execute 'set constraints all deferred';
 if (select max(revision) from public.agent_configuration_snapshots where business_id=b)<>v+2 then raise exception 'direct profile write not versioned'; end if;
 raise notice 'business public profile: all checks passed';
end $$;
rollback;
