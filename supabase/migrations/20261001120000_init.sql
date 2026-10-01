-- Agjenti.app: multi-tenant customer support platform.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create table public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	email text,
	display_name text,
	created_at timestamptz not null default now()
);

create table public.platform_admins (
	user_id uuid primary key references public.profiles (id) on delete cascade,
	created_at timestamptz not null default now()
);

create table public.businesses (
	id uuid primary key default gen_random_uuid(),
	name text not null,
	slug text not null unique,
	catalog_source text not null default 'internal'
		check (catalog_source in ('internal', 'zana', 'external')),
	auto_reply boolean not null default false,
	timezone text not null default 'Europe/Tirane',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table public.business_users (
	business_id uuid not null references public.businesses (id) on delete cascade,
	user_id uuid not null references public.profiles (id) on delete cascade,
	role text not null check (role in ('owner', 'staff')),
	created_at timestamptz not null default now(),
	primary key (business_id, user_id)
);

create index idx_business_users_user on public.business_users (user_id);

-- ---------------------------------------------------------------------------
-- Integrations + Instagram
-- ---------------------------------------------------------------------------

create table public.integrations (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	kind text not null default 'http'
		check (kind in ('http', 'zana')),
	catalog_url text,
	orders_url text,
	secret_ciphertext text,
	created_at timestamptz not null default now(),
	unique (business_id, kind)
);

create table public.instagram_connections (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	ig_user_id text not null unique,
	username text,
	access_token_ciphertext text not null,
	expires_at timestamptz,
	refreshed_at timestamptz,
	status text not null default 'connected'
		check (status in ('connected', 'expired', 'revoked', 'disconnected')),
	last_error text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index idx_instagram_connections_one_per_business
	on public.instagram_connections (business_id)
	where status <> 'disconnected';

-- ---------------------------------------------------------------------------
-- Customers / conversations
-- ---------------------------------------------------------------------------

create table public.customers (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	instagram_user_id text,
	username text,
	display_name text,
	phone text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index idx_customers_ig
	on public.customers (business_id, instagram_user_id)
	where instagram_user_id is not null;

create table public.conversations (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	customer_id uuid not null references public.customers (id) on delete cascade,
	instagram_connection_id uuid references public.instagram_connections (id) on delete set null,
	status text not null default 'active'
		check (status in ('active', 'paused', 'completed')),
	previous_conversation_id uuid references public.conversations (id) on delete set null,
	auto_reply boolean,
	last_message_at timestamptz not null default now(),
	last_inbound_at timestamptz,
	last_message_preview text,
	unread_count integer not null default 0,
	openai_previous_response_id text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index idx_conversations_business_last
	on public.conversations (business_id, last_message_at desc);

create index idx_conversations_customer
	on public.conversations (customer_id, created_at desc);

create table public.messages (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	conversation_id uuid not null references public.conversations (id) on delete cascade,
	direction text not null check (direction in ('inbound', 'outbound')),
	source text not null check (source in ('customer', 'agent', 'staff', 'system')),
	body text,
	external_message_id text,
	media jsonb,
	delivery_status text
		check (delivery_status is null or delivery_status in ('pending', 'sent', 'delivered', 'read', 'failed')),
	delivery_error text,
	instagram_connection_id uuid references public.instagram_connections (id) on delete set null,
	created_at timestamptz not null default now()
);

create unique index idx_messages_external
	on public.messages (instagram_connection_id, external_message_id)
	where external_message_id is not null;

create index idx_messages_conversation
	on public.messages (conversation_id, created_at asc);

create table public.conversation_states (
	conversation_id uuid primary key references public.conversations (id) on delete cascade,
	business_id uuid not null references public.businesses (id) on delete cascade,
	workflow_id uuid,
	step_key text,
	status text not null default 'in_progress'
		check (status in ('in_progress', 'ready', 'submitted', 'cancelled')),
	cart jsonb not null default '[]'::jsonb,
	customer_fields jsonb not null default '{}'::jsonb,
	collected jsonb not null default '{}'::jsonb,
	updated_at timestamptz not null default now()
);

create table public.webhook_events (
	id uuid primary key default gen_random_uuid(),
	external_event_id text not null unique,
	payload_hash text,
	status text not null default 'received',
	created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI, knowledge, products, workflows, orders
-- ---------------------------------------------------------------------------

create table public.ai_agents (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	name text not null,
	instructions text not null default '',
	is_active boolean not null default false,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index idx_ai_agents_one_active
	on public.ai_agents (business_id)
	where is_active is true;

create table public.knowledge_entries (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	title text not null,
	body text not null,
	intent_key text,
	product_type_id uuid,
	workflow_step_keys text[] not null default '{}',
	is_active boolean not null default true,
	sort_order integer not null default 0,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table public.workflows (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	name text not null,
	created_at timestamptz not null default now()
);

create table public.workflow_steps (
	id uuid primary key default gen_random_uuid(),
	workflow_id uuid not null references public.workflows (id) on delete cascade,
	key text not null,
	position integer not null,
	kind text not null check (kind in ('choice', 'text', 'photo', 'customer', 'confirm')),
	required boolean not null default true,
	config jsonb not null default '{}'::jsonb,
	unique (workflow_id, key),
	unique (workflow_id, position)
);

create table public.product_types (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	name text not null,
	workflow_id uuid references public.workflows (id) on delete set null,
	external_key text,
	created_at timestamptz not null default now()
);

alter table public.knowledge_entries
	add constraint knowledge_entries_product_type_fk
	foreign key (product_type_id) references public.product_types (id) on delete set null;

alter table public.conversation_states
	add constraint conversation_states_workflow_fk
	foreign key (workflow_id) references public.workflows (id) on delete set null;

create table public.products (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	product_type_id uuid references public.product_types (id) on delete set null,
	name text not null,
	price_amount numeric,
	currency text not null default 'ALL',
	source text not null default 'manual' check (source in ('manual', 'linked')),
	external_id text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create unique index idx_products_external
	on public.products (business_id, external_id)
	where external_id is not null;

create table public.orders (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references public.businesses (id) on delete cascade,
	conversation_id uuid references public.conversations (id) on delete set null,
	customer_id uuid references public.customers (id) on delete set null,
	status text not null default 'draft'
		check (status in ('draft', 'confirmed', 'submitted', 'failed')),
	currency text not null default 'ALL',
	total_amount numeric,
	external_system text,
	external_order_id text,
	payload jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create table public.order_items (
	id uuid primary key default gen_random_uuid(),
	order_id uuid not null references public.orders (id) on delete cascade,
	product_id uuid references public.products (id) on delete set null,
	product_type_key text,
	external_format_id text,
	quantity integer not null default 1,
	options jsonb not null default '{}'::jsonb,
	unit_amount numeric
);

create table public.integration_logs (
	id uuid primary key default gen_random_uuid(),
	business_id uuid references public.businesses (id) on delete cascade,
	direction text not null,
	target text not null,
	status text not null,
	error text,
	created_at timestamptz not null default now()
);

create index idx_integration_logs_business
	on public.integration_logs (business_id, created_at desc);

create table public.agent_turns (
	id uuid primary key default gen_random_uuid(),
	conversation_id uuid references public.conversations (id) on delete cascade,
	business_id uuid not null references public.businesses (id) on delete cascade,
	status text not null,
	reply text not null default '',
	accepted_updates jsonb not null default '{}'::jsonb,
	rejected_updates jsonb not null default '[]'::jsonb,
	elapsed_ms integer not null default 0,
	created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Auth helpers + RLS
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into public.profiles (id, email, display_name)
	values (
		new.id,
		new.email,
		coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email)
	)
	on conflict (id) do update
		set email = excluded.email,
			display_name = coalesce(public.profiles.display_name, excluded.display_name);
	return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function public.handle_new_user();

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select exists (
		select 1 from public.platform_admins where user_id = auth.uid()
	);
$$;

create or replace function public.is_business_member(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
	select public.is_platform_admin()
		or exists (
			select 1 from public.business_users
			where business_id = bid and user_id = auth.uid()
		);
$$;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_business_member(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.businesses enable row level security;
alter table public.business_users enable row level security;
alter table public.integrations enable row level security;
alter table public.instagram_connections enable row level security;
alter table public.customers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_states enable row level security;
alter table public.webhook_events enable row level security;
alter table public.ai_agents enable row level security;
alter table public.knowledge_entries enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.product_types enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.integration_logs enable row level security;
alter table public.agent_turns enable row level security;

create policy "profiles self" on public.profiles
	for select to authenticated using (id = auth.uid() or public.is_platform_admin());

create policy "platform admins read" on public.platform_admins
	for select to authenticated using (public.is_platform_admin());

create policy "businesses member" on public.businesses
	for select to authenticated using (public.is_business_member(id));

create policy "businesses admin write" on public.businesses
	for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "business users member" on public.business_users
	for select to authenticated using (public.is_business_member(business_id));

create policy "business users admin write" on public.business_users
	for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "tenant select integrations" on public.integrations
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write integrations" on public.integrations
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select ig" on public.instagram_connections
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write ig" on public.instagram_connections
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select customers" on public.customers
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write customers" on public.customers
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select conv" on public.conversations
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write conv" on public.conversations
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select messages" on public.messages
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write messages" on public.messages
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select state" on public.conversation_states
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write state" on public.conversation_states
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select agents" on public.ai_agents
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write agents" on public.ai_agents
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select knowledge" on public.knowledge_entries
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write knowledge" on public.knowledge_entries
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select workflows" on public.workflows
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write workflows" on public.workflows
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select steps" on public.workflow_steps
	for select to authenticated using (
		exists (select 1 from public.workflows w where w.id = workflow_id and public.is_business_member(w.business_id))
	);
create policy "tenant write steps" on public.workflow_steps
	for all to authenticated using (
		exists (select 1 from public.workflows w where w.id = workflow_id and public.is_business_member(w.business_id))
	) with check (
		exists (select 1 from public.workflows w where w.id = workflow_id and public.is_business_member(w.business_id))
	);

create policy "tenant select types" on public.product_types
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write types" on public.product_types
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select products" on public.products
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write products" on public.products
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select orders" on public.orders
	for select to authenticated using (public.is_business_member(business_id));
create policy "tenant write orders" on public.orders
	for all to authenticated using (public.is_business_member(business_id)) with check (public.is_business_member(business_id));

create policy "tenant select order items" on public.order_items
	for select to authenticated using (
		exists (select 1 from public.orders o where o.id = order_id and public.is_business_member(o.business_id))
	);
create policy "tenant write order items" on public.order_items
	for all to authenticated using (
		exists (select 1 from public.orders o where o.id = order_id and public.is_business_member(o.business_id))
	) with check (
		exists (select 1 from public.orders o where o.id = order_id and public.is_business_member(o.business_id))
	);

create policy "tenant select logs" on public.integration_logs
	for select to authenticated using (public.is_business_member(business_id));

create policy "tenant select turns" on public.agent_turns
	for select to authenticated using (public.is_business_member(business_id));

-- webhook_events: service role only (no authenticated policies)

-- Seed placeholder business (membership added by Platform Admin later).
insert into public.businesses (name, slug, catalog_source, auto_reply)
values ('Zana Store', 'zana', 'zana', true)
on conflict (slug) do nothing;
