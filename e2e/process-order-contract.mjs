import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export function verifyProcessOrder({ sql, literal, json, root, business, conversation, token }) {
  sql(`alter table conversations add column customer_id uuid, add column participant_username text;
    alter table conversation_states add column cart jsonb default '[]';
    create table products(id uuid primary key,business_id uuid,name text,product_type_id uuid,price_amount numeric,currency text,is_active boolean,external_id text,workflow_id uuid);
    create table product_types(id uuid primary key,external_key text,is_active boolean);
    create table linear_workflow_versions(id uuid primary key,business_id uuid,workflow_id uuid);
    create table visual_workflow_versions(id uuid primary key,business_id uuid,graph jsonb);
    create table business_automation_policies(business_id uuid primary key,local_orders boolean);
    create table customers(id uuid primary key default gen_random_uuid(),business_id uuid,instagram_user_id text,whatsapp_user_id text,username text,display_name text,phone text,updated_at timestamptz);
    create unique index on customers(business_id,instagram_user_id) where instagram_user_id is not null;
    create unique index on customers(business_id,whatsapp_user_id) where whatsapp_user_id is not null;
    create table orders(id uuid primary key default gen_random_uuid(),business_id uuid,conversation_id uuid,customer_id uuid,status text,currency text,total_amount numeric,payload jsonb);
    create table order_items(order_id uuid,product_id uuid,product_type_key text,external_format_id text,quantity integer,options jsonb,unit_amount numeric);
    create table order_submissions(order_id uuid primary key,business_id uuid,conversation_id uuid,confirmation_id uuid,confirmation jsonb,state_revision integer,created_by uuid,executor_kind text,
      attempt_id uuid default gen_random_uuid(),status text default 'pending_reconciliation',external_order_id text,unique(business_id,conversation_id,confirmation_id));
    create function public.business_module_allowed(uuid,text) returns boolean language sql as $$select true$$;
    create function public.assert_order_actor(uuid,uuid) returns void language plpgsql as $$begin
      if not exists(select 1 from public.platform_admins where user_id=$2) and not exists(select 1 from public.business_users where business_id=$1 and user_id=$2) then raise exception 'unauthorized'; end if;
    end $$;`);
  sql(readFileSync(path.join(root, 'supabase/migrations/20261106160000_process_order_submission.sql'), 'utf8'));
  sql(readFileSync(path.join(root, 'supabase/migrations/20261106170000_process_linear_orders.sql'), 'utf8'));
  const product = randomUUID(), version = randomUUID(), actionId = randomUUID(), user = randomUUID();
  const action = { id: actionId, tool: 'order.create', toolVersion: 1, status: 'running', inputDigest: 'test-digest', approval: { waitId: randomUUID(), expiresAt: Date.now() + 600000 },
    input: { productId: product, productName: 'Product', productTypeId: 'none', unitAmount: 25, currency: 'EUR', quantity: 1,
      options: JSON.stringify({ size: 'M' }), name: 'Example Customer', phone: '+355691234567', city: 'Tirane', address: 'Example address' } };
  const state = { schemaVersion: 4, mode: 'live', businessId: business, conversationId: conversation, instances: { instance: { definitionId: 'order', versionId: version, action } } };
  const setState = value => sql(`update conversation_states set revision=20,collected=${json(value)} where conversation_id=${literal(conversation)};`);
  const call = (id = actionId, actor = null) => `select public.submit_process_order(${literal(business)},${literal(conversation)},20,${literal(id)},${actor ? literal(actor) : 'null'},${actor ? 'null' : '1'},${actor ? 'null' : literal(token)});`;
  sql(`insert into products values(${literal(product)},${literal(business)},'Product',null,25,'EUR',true,null,null);
    insert into visual_workflow_versions values(${literal(version)},${literal(business)},${json({ version: 2, flows: [{ id: 'order', kind: 'order', productIds: [product] }] })});
    insert into business_automation_policies values(${literal(business)},false);
    insert into platform_admins values(${literal(user)});
    update workflow_inbound_queue set status='processing',leased_until=now()+interval '10 minutes' where id=1;`);
  setState(state);
  assert.equal(JSON.parse(sql(call())).status, 'awaiting_staff');
  assert.equal(sql('select count(*) from orders;'), '0');
  sql('update products set price_amount=30;');
  assert.throws(() => sql(call()), /commercial_terms_changed/);
  sql('update products set price_amount=25;');
  setState({ ...state, instances: { instance: { ...state.instances.instance, action: { ...action, approval: { ...action.approval, expiresAt: 0 } } } } });
  assert.throws(() => sql(call()), /confirmation_required/);
  setState(state);
  sql('update business_automation_policies set local_orders=true;');
  assert.equal(JSON.parse(sql(call())).status, 'local_only');
  assert.equal(JSON.parse(sql(call())).dispatch, false);
  assert.equal(sql('select count(*) from orders;'), '1');
  assert.equal(sql('select count(*) from order_items;'), '1');
  assert.equal(sql('select count(*) from customers;'), '1');
  const manualId = randomUUID(), manual = { ...action, id: manualId, status: 'succeeded', output: { submissionStatus: 'awaiting_staff' } };
  setState({ ...state, instances: { instance: { ...state.instances.instance, action: manual } } });
  assert.throws(() => sql(call(manualId, randomUUID())), /unauthorized/);
  const receipt = JSON.parse(sql(call(manualId, user)));
  assert.equal(receipt.dispatch, true);
  assert.equal(receipt.payload.items[0].unitAmount, 25);
  assert.equal(JSON.parse(sql(call(manualId, user))).dispatch, false);
  assert.equal(sql('select count(*) from orders;'), '2');
  assert.equal(sql('select count(*) from customers;'), '1');
  const linearVersion = randomUUID(), workflow = randomUUID(), linearAction = randomUUID();
  sql(`insert into linear_workflow_versions values(${literal(linearVersion)},${literal(business)},${literal(workflow)}); update products set workflow_id=${literal(workflow)};`);
  setState({ ...state, instances: { instance: { definitionId: `linear_${workflow}`, versionId: linearVersion, action: { ...action, id: linearAction } } } });
  assert.equal(JSON.parse(sql(call(linearAction))).status, 'local_only');
  assert.equal(sql('select count(*) from orders;'), '3');
  console.log('PASS: process order transaction protects current terms/approval, automation policy, manual authority, one-time dispatch and deduplication.');
}
