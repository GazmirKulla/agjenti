-- The status an order has on the business website (its own workflow, e.g. "Në printim"),
-- separate from Agjenti's submission status. Written only from the website's answers and notices.
alter table public.orders
  add column if not exists external_status text check (external_status is null or char_length(external_status) <= 40),
  add column if not exists external_status_label text check (external_status_label is null or char_length(external_status_label) <= 80),
  add column if not exists external_status_at timestamptz;

create index if not exists orders_business_external_order_idx
  on public.orders (business_id, external_order_id) where external_order_id is not null;
