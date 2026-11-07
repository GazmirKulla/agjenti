import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function verifyProcessCutover({ sql, literal, json, root, business, conversation }) {
  sql(`alter table conversation_states add column if not exists customer_fields jsonb default '{}';`);
  const legacy = randomUUID(), fresh = randomUUID();
  sql(`insert into conversations(id,business_id,channel) values(${literal(legacy)},${literal(business)},'panel');
    insert into conversation_states(conversation_id,business_id,collected,revision,cart,customer_fields)
    values(${literal(legacy)},${literal(business)},'{"schemaVersion":3,"fields":{"old":"value"}}',9,'[{"old":true}]','{"old":true}');
    insert into workflow_inbound_queue(business_id,conversation_id,status,operation_kind,reply) values
      (${literal(business)},${literal(legacy)},'queued','panel','old'),
      (${literal(business)},${literal(legacy)},'uncertain','staff','keep receipt');`);
  const native = sql(`select collected from conversation_states where conversation_id=${literal(conversation)}`);
  const migration = readFileSync(path.join(root,'supabase/migrations/20261107163000_process_state_cutover.sql'),'utf8');
  sql(`update workflow_inbound_queue set status='processing',leased_until=now()+interval '1 minute' where conversation_id=${literal(legacy)} and operation_kind='panel';`);
  assert.throws(()=>sql(migration),/cutover_worker_active/);
  assert.equal(sql(`select revision from conversation_states where conversation_id=${literal(legacy)}`),'9');
  sql(`update workflow_inbound_queue set status='queued',leased_until=null where conversation_id=${literal(legacy)} and operation_kind='panel';`);
  sql(migration);
  const next=JSON.parse(sql(`select collected from conversation_states where conversation_id=${literal(legacy)}`));
  assert.deepEqual(next,{schemaVersion:4,mode:'live',businessId:business,conversationId:legacy,revision:10,instances:{},offers:{},focusId:null});
  assert.equal(sql(`select collected from conversation_states where conversation_id=${literal(conversation)}`),native);
  assert.equal(sql(`select status from workflow_inbound_queue where conversation_id=${literal(legacy)} and operation_kind='panel'`),'ignored');
  assert.equal(sql(`select status||':'||reply from workflow_inbound_queue where conversation_id=${literal(legacy)} and operation_kind='staff'`),'uncertain:keep receipt');
  assert.equal(sql(`select cart::text||customer_fields::text from conversation_states where conversation_id=${literal(legacy)}`),'[]{}');
  assert.throws(()=>sql(`update conversation_states set collected='{}' where conversation_id=${literal(legacy)}`),/conversation_states_native_snapshot/);
  assert.throws(()=>sql(`update conversation_states set revision=revision+1 where conversation_id=${literal(legacy)}`),/conversation_states_native_snapshot/);
  assert.throws(()=>sql(`update conversation_states set collected=${json({...next,businessId:randomUUID()})} where conversation_id=${literal(legacy)}`),/conversation_states_native_snapshot/);
  sql(`insert into conversations(id,business_id,channel) values(${literal(fresh)},${literal(business)},'panel');
    insert into conversation_states(conversation_id,business_id) values(${literal(fresh)},${literal(business)});`);
  const initialized=JSON.parse(sql(`select collected from conversation_states where conversation_id=${literal(fresh)}`));
  assert.equal(initialized.schemaVersion,4); assert.equal(initialized.revision,0); assert.equal(initialized.conversationId,fresh);
  console.log('PASS: native cutover, worker fence, scoped reset, preserved native/staff receipts, insert initialization and legacy write rejection.');
}
