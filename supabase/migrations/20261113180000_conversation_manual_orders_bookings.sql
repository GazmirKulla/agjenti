-- Conversation panel, phase 2: the owner records an order or an appointment from a conversation.
begin;

-- A booking the owner makes from a conversation stays visible in that conversation.
alter table public.bookings add column if not exists conversation_id uuid references public.conversations(id) on delete set null;
create index if not exists bookings_conversation on public.bookings(business_id, conversation_id) where conversation_id is not null;

-- One request key = one manual order (a lost response is replayed, never duplicated).
create unique index if not exists orders_manual_request_key on public.orders(business_id, (payload->>'requestKey'))
  where payload->>'source' = 'manual';

/*
 * A LOCAL order the owner records from a conversation. Price and currency come
 * from the catalog, never from the client. Nothing is sent to an external
 * system; external submission keeps its own reviewed path.
 */
create or replace function public.create_manual_order(
  p_business uuid, p_user uuid, p_conversation uuid, p_product uuid, p_quantity integer,
  p_customer jsonb, p_note text, p_request_key text
) returns uuid language plpgsql security definer set search_path=public, pg_temp as $$
declare c public.conversations; p public.products; cid uuid; oid uuid; v_name text; v_phone text;
begin
 if not exists(select 1 from business_users where business_id = p_business and user_id = p_user)
  and not exists(select 1 from platform_admins where user_id = p_user) then raise exception 'unauthorized'; end if;
 if p_request_key is null or char_length(p_request_key) not between 8 and 200 then raise exception 'invalid_request'; end if;
 select id into oid from orders where business_id = p_business and payload->>'source' = 'manual' and payload->>'requestKey' = p_request_key;
 if found then return oid; end if;
 if p_quantity is null or p_quantity not between 1 and 999 then raise exception 'invalid_quantity'; end if;
 if jsonb_typeof(p_customer) is distinct from 'object' or octet_length(p_customer::text) > 4000 then raise exception 'invalid_customer'; end if;
 v_name := nullif(btrim(p_customer->>'name'), '');
 v_phone := nullif(btrim(p_customer->>'phone'), '');
 if v_name is null or char_length(v_name) not between 2 and 120 or v_phone is null or char_length(v_phone) > 40 then raise exception 'customer_required'; end if;
 if char_length(coalesce(p_note, '')) > 1000 then raise exception 'invalid_note'; end if;

 select * into c from conversations where id = p_conversation and business_id = p_business for update;
 if not found then raise exception 'invalid_conversation'; end if;
 select * into p from products where id = p_product and business_id = p_business for share;
 if not found or not p.is_active or p.archived_at is not null then raise exception 'product_unavailable'; end if;
 if p.price_amount is null or p.price_amount < 0 or p.currency !~ '^[A-Z]{3}$' then raise exception 'price_missing'; end if;

 -- The conversation's customer, an existing one with the same channel identity, or a new one.
 cid := c.customer_id;
 if cid is not null then
  perform 1 from customers where id = cid and business_id = p_business;
  if not found then cid := null; end if;
 end if;
 if cid is null and c.whatsapp_participant_id is not null then
  select id into cid from customers where business_id = p_business and whatsapp_user_id = c.whatsapp_participant_id limit 1;
 elsif cid is null and c.instagram_participant_id is not null then
  select id into cid from customers where business_id = p_business and instagram_user_id = c.instagram_participant_id limit 1;
 end if;
 if cid is null then
  insert into customers(business_id, instagram_user_id, whatsapp_user_id, username, display_name, phone)
   values(p_business, c.instagram_participant_id, c.whatsapp_participant_id, c.participant_username, v_name, v_phone) returning id into cid;
 else
  -- Fill only what the customer record is missing; saved details are never overwritten.
  update customers set phone = coalesce(customers.phone, v_phone), display_name = coalesce(customers.display_name, v_name), updated_at = now()
   where id = cid and (customers.phone is null or customers.display_name is null);
 end if;
 update conversations set customer_id = cid, updated_at = now() where id = c.id and customer_id is distinct from cid;

 insert into orders(business_id, conversation_id, customer_id, status, currency, total_amount, payload)
  values(p_business, c.id, cid, 'confirmed', p.currency, p.price_amount * p_quantity, jsonb_build_object(
   'source', 'manual', 'requestKey', p_request_key, 'createdBy', p_user,
   'product_id', p.id, 'product_name', p.name, 'quantity', p_quantity,
   'customer', jsonb_build_object('name', v_name, 'phone', v_phone,
     'city', nullif(btrim(p_customer->>'city'), ''), 'address', nullif(btrim(p_customer->>'address'), '')),
   'note', nullif(btrim(coalesce(p_note, '')), '')))
  returning id into oid;
 insert into order_items(order_id, product_id, quantity, options, unit_amount)
  values(oid, p.id, p_quantity, '{}'::jsonb, p.price_amount);
 return oid;
end $$;

revoke all on function public.create_manual_order(uuid,uuid,uuid,uuid,integer,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.create_manual_order(uuid,uuid,uuid,uuid,integer,jsonb,text,text) to service_role;

commit;
