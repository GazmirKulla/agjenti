-- Catalog source is only internal (manual) or external (HTTP API).
-- Collapse legacy "zana" mode into external + http integrations.

-- Merge zana integration rows into http (prefer http if both exist).
update public.integrations as z
set kind = 'http'
where z.kind = 'zana'
  and not exists (
    select 1
    from public.integrations h
    where h.business_id = z.business_id
      and h.kind = 'http'
  );

delete from public.integrations where kind = 'zana';

update public.businesses
set catalog_source = 'external'
where catalog_source = 'zana';

alter table public.businesses drop constraint if exists businesses_catalog_source_check;
alter table public.businesses
  add constraint businesses_catalog_source_check
  check (catalog_source in ('internal', 'external'));

alter table public.integrations drop constraint if exists integrations_kind_check;
alter table public.integrations
  add constraint integrations_kind_check
  check (kind in ('http'));
