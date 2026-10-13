begin;
create table public.platform_actions (
 key text primary key, enabled boolean not null default true,
 version integer not null default 1 check(version=1)
);
insert into platform_actions(key) values('business.provision'),('product.create'),('service.create');
create table public.plan_actions (
 plan text not null check(plan in ('free','starter','professional','enterprise')),
 action_key text references platform_actions(key), enabled boolean not null default false,
 monthly_limit integer check(monthly_limit>=0), primary key(plan,action_key)
);
insert into plan_actions(plan,action_key,enabled)
select p,a.key,a.key<>'business.provision' from unnest(array['free','starter','professional','enterprise']) p cross join platform_actions a;
create table public.business_actions (
 business_id uuid references businesses(id) on delete cascade,
 action_key text references platform_actions(key), enabled boolean, expires_at timestamptz,
 monthly_limit integer check(monthly_limit>=0), primary key(business_id,action_key)
);
create table public.business_action_settings (
 business_id uuid references businesses(id) on delete cascade,
 action_key text references platform_actions(key),
 owner_allowed boolean not null default true, staff_allowed boolean not null default false,
 automation_allowed boolean not null default false,
 invitation_days integer not null default 7 check(invitation_days between 1 and 30),
 primary key(business_id,action_key)
);
create table public.action_executions (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 action_key text not null references platform_actions(key), request_key text not null check(length(request_key) between 1 and 250),
 actor_id uuid references auth.users(id) on delete set null,
 workflow_version_id uuid, node_id text, conversation_id uuid references conversations(id) on delete set null,
 input jsonb not null, status text not null check(status in ('succeeded','failed','pending','uncertain')),
 result jsonb, created_at timestamptz not null default now(), unique(business_id,action_key,request_key),
 foreign key(business_id,workflow_version_id) references visual_workflow_versions(business_id,id)
);
create table public.business_invitations (
 id uuid primary key default gen_random_uuid(), source_business_id uuid not null references businesses(id) on delete cascade,
 target_business_id uuid not null unique references businesses(id) on delete cascade,
 execution_id uuid not null unique references action_executions(id) on delete cascade,
 email text not null, details jsonb not null default '{}',
 token_hash text not null unique, token_ciphertext text not null,
 status text not null default 'pending' check(status in ('pending','accepted','revoked')),
 expires_at timestamptz not null, accepted_by uuid references auth.users(id), accepted_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.action_policy_events (
 id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id),
 scope text not null, target text not null, action_key text not null, changes jsonb not null, created_at timestamptz not null default now()
);
do $$ declare t text; begin
 foreach t in array array['platform_actions','plan_actions','business_actions','business_action_settings','action_executions','business_invitations','action_policy_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.can_execute_business_action(p_business uuid,p_user uuid,p_action text,p_automated boolean default false) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare allowed boolean; override business_actions; settings business_action_settings; member_role text;
begin
 if not exists(select 1 from platform_actions where key=p_action and enabled) then return false; end if;
 select pa.enabled into allowed from business_billing b join plan_actions pa on pa.plan=b.plan and pa.action_key=p_action where b.business_id=p_business;
 select * into override from business_actions where business_id=p_business and action_key=p_action and (expires_at is null or expires_at>now());
 if override.enabled is not null then allowed:=override.enabled; end if;
 if not coalesce(allowed,false) then return false; end if;
 select * into settings from business_action_settings where business_id=p_business and action_key=p_action;
 if p_automated then return coalesce(settings.automation_allowed,false); end if;
 if p_user is null then return false; end if;
 if exists(select 1 from platform_admins where user_id=p_user) then return true; end if;
 select role into member_role from business_users where business_id=p_business and user_id=p_user;
 return case member_role when 'owner' then coalesce(settings.owner_allowed,true) when 'staff' then coalesce(settings.staff_allowed,p_action<>'business.provision') else false end;
end $$;

create function public.provision_business_invitation(p_source uuid,p_user uuid,p_request text,p_input jsonb,p_token_hash text,p_token_ciphertext text,p_version uuid default null,p_node text default null,p_conversation uuid default null,p_guard jsonb default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare prior action_executions; invitation business_invitations; target uuid; eid uuid; days integer; quota integer; override business_actions; business_slug text; job workflow_inbound_queue; c conversations; current_revision integer; auto_enabled boolean;
begin
 if p_version is not null then
  select * into job from workflow_inbound_queue where id=(p_guard->>'jobId')::bigint and lease_token=(p_guard->>'leaseToken')::uuid and business_id=p_source and status='processing' and leased_until>now() for update;
  if not found then raise exception 'lease_lost'; end if;
  select * into c from conversations where id=p_conversation and business_id=p_source and channel=job.channel and coalesce(whatsapp_participant_id,instagram_participant_id)=job.participant_id and coalesce(whatsapp_connection_id,instagram_connection_id)=job.connection_id for update;
  if not found then raise exception 'invalid_conversation'; end if;
 end if;
 -- Serialize policy/allowance and retries for this source business.
 perform 1 from businesses where id=p_source for update;
 if not found or not can_execute_business_action(p_source,p_user,'business.provision',p_version is not null) then raise exception 'unauthorized'; end if;
 if p_version is not null then
  select coalesce(c.auto_reply,auto_reply,false) into auto_enabled from businesses where id=p_source;
  if c.status<>'active' or not auto_enabled then raise exception 'ownership_lost'; end if;
  select revision into current_revision from conversation_states where conversation_id=p_conversation and business_id=p_source for update;
  if current_revision is distinct from (p_guard->>'revision')::integer then raise exception 'stale_state'; end if;
 end if;
 if length(p_request) not between 1 and 250 or p_request is null or jsonb_typeof(p_input) is distinct from 'object'
 or coalesce(length(btrim(p_input->>'name')),0) not between 2 and 120
 or coalesce(p_input->>'email','')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or length(p_input->>'email')>254 or coalesce(length(p_input->>'description'),0)>2000
 or p_token_hash!~'^[0-9a-f]{64}$' then raise exception 'invalid_input'; end if;
 if p_version is not null then
  if p_conversation is null or not exists(select 1 from conversations where id=p_conversation and business_id=p_source)
   or not exists(select 1 from visual_workflow_versions v join visual_workflows w on w.business_id=v.business_id and w.enabled
    where v.id=p_version and v.business_id=p_source and exists(select 1 from jsonb_array_elements(v.graph->'nodes') n where n->>'id'=p_node and n->>'kind'='action' and n->'config'->'action'->>'actionKey'='business.provision')) then raise exception 'invalid_workflow_action'; end if;
 end if;
 select * into prior from action_executions where business_id=p_source and action_key='business.provision' and request_key=p_request;
 if found then
  if prior.input<>p_input or prior.workflow_version_id is distinct from p_version or prior.conversation_id is distinct from p_conversation then raise exception 'request_conflict'; end if;
 end if;
 if prior.id is not null and prior.status='succeeded' then
  select * into invitation from business_invitations where execution_id=prior.id;
 else
  select pa.monthly_limit into quota from business_billing b join plan_actions pa on pa.plan=b.plan and pa.action_key='business.provision' where b.business_id=p_source;
  select * into override from business_actions where business_id=p_source and action_key='business.provision' and (expires_at is null or expires_at>now());
  quota:=coalesce(override.monthly_limit,quota);
  if quota is not null and (select count(*) from action_executions where business_id=p_source and action_key='business.provision' and status='succeeded' and created_at>=date_trunc('month',now() at time zone 'Europe/Tirane') at time zone 'Europe/Tirane')>=quota then raise exception 'action_limit'; end if;
  target:=gen_random_uuid();
  business_slug:=allocate_business_slug(p_input->>'name');
  insert into businesses(id,name,slug,catalog_source,auto_reply) values(target,btrim(p_input->>'name'),business_slug,'internal',false);
  insert into action_executions(business_id,action_key,request_key,actor_id,workflow_version_id,node_id,conversation_id,input,status,result)
   values(p_source,'business.provision',p_request,p_user,p_version,p_node,p_conversation,p_input,'succeeded',jsonb_build_object('businessId',target)) on conflict(business_id,action_key,request_key) do update set status='succeeded',result=excluded.result,created_at=now() returning id into eid;
  select invitation_days into days from business_action_settings where business_id=p_source and action_key='business.provision';
  insert into business_invitations(source_business_id,target_business_id,execution_id,email,details,token_hash,token_ciphertext,expires_at)
   values(p_source,target,eid,lower(btrim(p_input->>'email')),p_input,p_token_hash,p_token_ciphertext,now()+make_interval(days=>coalesce(days,7))) returning * into invitation;
 end if;
 return jsonb_build_object('business_id',invitation.target_business_id,'token_ciphertext',invitation.token_ciphertext,'expires_at',invitation.expires_at,'status',case when invitation.status='pending' and invitation.expires_at<=now() then 'expired' else invitation.status end);
end $$;

create function public.accept_business_invitation(p_hash text,p_user uuid) returns text
language plpgsql security definer set search_path=public as $$
declare invitation business_invitations; user_email text; confirmed timestamptz; slug_value text;
begin
 select * into invitation from business_invitations where token_hash=p_hash for update;
 if not found then raise exception 'invalid_invitation'; end if;
 if invitation.status='accepted' and invitation.accepted_by=p_user then select slug into slug_value from businesses where id=invitation.target_business_id; return slug_value; end if;
 if invitation.status<>'pending' or invitation.expires_at<=now() then raise exception 'invalid_invitation'; end if;
 select lower(email),email_confirmed_at into user_email,confirmed from auth.users where id=p_user;
 if confirmed is null or user_email is distinct from invitation.email then raise exception 'recipient_mismatch'; end if;
 perform 1 from businesses where id=invitation.target_business_id for update;
 if exists(select 1 from business_users where business_id=invitation.target_business_id and role='owner') then raise exception 'already_owned'; end if;
 insert into business_users(business_id,user_id,role) values(invitation.target_business_id,p_user,'owner') on conflict(business_id,user_id) do update set role='owner';
 update business_invitations set status='accepted',accepted_by=p_user,accepted_at=now() where id=invitation.id;
 select slug into slug_value from businesses where id=invitation.target_business_id;
 return slug_value;
end $$;

create function public.rotate_business_invitation(p_id uuid,p_source uuid,p_user uuid,p_hash text,p_ciphertext text,p_revoke boolean) returns void
language plpgsql security definer set search_path=public as $$
declare i business_invitations; days integer;
begin
 if not can_execute_business_action(p_source,p_user,'business.provision',false) then raise exception 'unauthorized'; end if;
 select * into i from business_invitations where id=p_id and source_business_id=p_source for update;
 if not found or i.status='accepted' then raise exception 'invalid_invitation'; end if;
 select invitation_days into days from business_action_settings where business_id=p_source and action_key='business.provision';
 update business_invitations set status=case when p_revoke then 'revoked' else 'pending' end,
 token_hash=case when p_revoke then token_hash else p_hash end,token_ciphertext=case when p_revoke then token_ciphertext else p_ciphertext end,
 expires_at=case when p_revoke then expires_at else now()+make_interval(days=>coalesce(days,7)) end where id=p_id;
 insert into action_policy_events(actor_id,scope,target,action_key,changes) values(p_user,'invitation',p_id::text,'business.provision',jsonb_build_object('operation',case when p_revoke then 'revoke' else 'rotate' end));
end $$;
revoke all on function public.can_execute_business_action(uuid,uuid,text,boolean),public.provision_business_invitation(uuid,uuid,text,jsonb,text,text,uuid,text,uuid,jsonb),public.accept_business_invitation(text,uuid),public.rotate_business_invitation(uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.can_execute_business_action(uuid,uuid,text,boolean),public.provision_business_invitation(uuid,uuid,text,jsonb,text,text,uuid,text,uuid,jsonb),public.accept_business_invitation(text,uuid),public.rotate_business_invitation(uuid,uuid,uuid,text,text,boolean) to service_role;
commit;
