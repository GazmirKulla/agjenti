-- Track Meta data-deletion callback confirmations for Instagram Login compliance.
create table public.meta_data_deletion_requests (
	id uuid primary key default gen_random_uuid(),
	confirmation_code text not null unique,
	meta_user_id text not null,
	instagram_connection_id uuid references public.instagram_connections (id) on delete set null,
	business_id uuid references public.businesses (id) on delete set null,
	status text not null default 'completed'
		check (status in ('pending', 'completed', 'failed')),
	status_url text not null,
	created_at timestamptz not null default now(),
	completed_at timestamptz
);

create index idx_meta_data_deletion_meta_user
	on public.meta_data_deletion_requests (meta_user_id);

alter table public.meta_data_deletion_requests enable row level security;
-- service role only (no authenticated policies)
