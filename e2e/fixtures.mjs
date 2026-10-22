import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { work, verifyContainers, localKeys, sql } from './local.mjs';

export const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export const json = value => `${quote(JSON.stringify(value))}::jsonb`;
const node = (id, kind, config = {}) => ({ id, kind, label: id, position: { x: 100, y: 100 }, config });
const edge = (source, target, port = 'next') => ({ id: `${source}-${port}`, source, target, port });
export function graphFor(tenant, variant = 'A') {
  const start = node('start', 'start'), end = node('end', 'end');
  if (tenant.kind === 'information') return { version: 2, name: 'E2E information', nodes: [start, node('info', 'knowledge'), end],
    edges: [edge('start', 'info'), edge('info', 'end')], flows: [{ id: 'info', kind: 'information', label: 'Information', entryNodeId: 'info', nodeIds: ['info'] }] };
  if (tenant.kind === 'appointment') return { version: 2, name: 'E2E appointment', nodes: [start, node('booking', 'booking'), end],
    edges: [edge('start', 'booking'), edge('booking', 'end')], flows: [{ id: 'booking', kind: 'booking', label: 'Appointment', entryNodeId: 'booking', nodeIds: ['booking'], serviceIds: [tenant.entityId] }] };
  const retail = tenant.kind === 'retail';
  const first = retail ? 'size' : 'project_type', second = retail ? 'quantity' : 'budget';
  return { version: 2, name: `E2E ${tenant.kind} ${variant}`, nodes: [start,
    node(first, 'collect', { fieldKey: first, fieldType: 'text', prompt: `${first} ${variant}?` }),
    node(second, 'collect', { fieldKey: second, fieldType: 'number', prompt: `${second} ${variant}?` }),
    node('confirm', 'confirm', { prompt: `Confirm ${variant}?` }), end],
    edges: [edge('start', first), edge(first, second), edge(second, 'confirm'), edge('confirm', 'end', 'yes'), edge('confirm', first, 'no')],
    flows: [{ id: tenant.kind, kind: retail ? 'order' : 'custom', label: tenant.kind, entryNodeId: first, nodeIds: [first, second, 'confirm'],
      ...(retail ? { productIds: [tenant.entityId] } : { serviceIds: [tenant.entityId] }) }] };
}

async function main() {
  verifyContainers();
  const target = path.join(work, 'fixtures.json');
  if (existsSync(target)) { console.log('Synthetic fixtures already exist; not resetting existing state.'); return; }
  assert.ok(existsSync(path.join(work, 'migrations.json')), 'Schema replay required');
  const keys = localKeys();
  const admin = createClient(keys.api, keys.service, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.equal(sql('select count(*) from auth.users;'), '0', 'Unknown users; refuse fixture overwrite');
  const password = `E2E-only-${randomBytes(18).toString('hex')}`;
  const tenants = ['retail', 'appointment', 'quote', 'information'].map((kind, i) => ({
    kind, id: `b0000000-0000-4000-8000-00000000000${i + 1}`, entityId: `c0000000-0000-4000-8000-00000000000${i + 1}`,
    slug: `e2e-${kind}`, name: `E2E ${kind}`, email: `${kind}@example.test`,
    modules: ['workflows', 'knowledge', 'agents', 'inbox', 'settings', ...(kind === 'retail' ? ['products', 'orders'] : kind === 'appointment' ? ['services', 'bookings', 'calendar'] : kind === 'quote' ? ['services'] : [])],
  }));
  const createUser = async email => {
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (result.error) throw result.error;
    return result.data.user.id;
  };
  for (const tenant of tenants) tenant.userId = await createUser(tenant.email);
  const labUser = { email: 'lab@example.test', id: await createUser('lab@example.test') };
  let statement = 'begin;\n';
  for (const t of tenants) {
    statement += `insert into public.businesses(id,name,slug,catalog_source,auto_reply,dashboard_profile) values(${quote(t.id)},${quote(t.name)},${quote(t.slug)},'internal',false,${json({ version: 1, source: 'manual', enabledModules: t.modules })});\n`;
    statement += `insert into public.business_users(business_id,user_id,role) values(${quote(t.id)},${quote(t.userId)},'owner');\n`;
    if (t.kind === 'retail') statement += `insert into public.products(id,business_id,name,sku,price_amount,currency,is_active) values(${quote(t.entityId)},${quote(t.id)},'E2E Shirt','M',20,'EUR',true);\n`;
    if (['appointment', 'quote'].includes(t.kind)) statement += `insert into public.booking_services(id,business_id,name,duration_minutes,booking_enabled,is_active) values(${quote(t.entityId)},${quote(t.id)},${quote(t.kind === 'appointment' ? 'E2E Consultation' : 'E2E Website')},30,${t.kind === 'appointment'},true);\n`;
    if (t.kind === 'appointment') statement += `insert into public.business_calendar_settings(business_id,agent_booking_enabled,confirmation_mode,timezone) values(${quote(t.id)},true,'manual','Europe/Tirane');\n`;
    statement += `insert into public.knowledge_entries(business_id,title,body,is_active) values(${quote(t.id)},'E2E hours','Synthetic business opens at 09:00. No real actions.',true);\n`;
    statement += `select public.save_visual_workflow(${quote(t.id)},${quote(t.userId)},0,${json(graphFor(t))},'publish');\n`;
    // Draft is deliberately different, proving published chat does not use it.
    statement += `select public.save_visual_workflow(${quote(t.id)},${quote(t.userId)},1,${json(graphFor(t, 'DRAFT'))},'draft');\n`;
  }
  statement += `insert into public.platform_admins(user_id) values(${quote(labUser.id)});\ncommit;`;
  sql(statement);
  for (const t of tenants) t.versionA = sql(`select published_version_id from public.visual_workflows where business_id=${quote(t.id)};`);
  writeFileSync(target, JSON.stringify({ password, labUser, encryptionKey: randomBytes(32).toString('hex'), tenants }, null, 2), { mode: 0o600 });
  assert.equal(sql('select (select count(*) from public.integrations)+(select count(*) from public.instagram_connections)+(select count(*) from public.whatsapp_connections)+(select count(*) from public.google_calendar_connections);'), '0');
  console.log('Created four independent tenants, four owners and one explicit lab admin. No real integrations.');
}
if (process.argv[1]?.endsWith('/fixtures.mjs')) main().catch(error => { console.error(error.message); process.exitCode = 1; });
