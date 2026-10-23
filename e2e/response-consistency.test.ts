/** Real local Auth/PostgREST/coordinator and SQL queue preparation; only LLM output
 * is synthetic. This is not real-model or live-channel E2E certification. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { work, project, verifyContainers, localKeys, sql } from './local.mjs';
import { quote } from './fixtures.mjs';
import { processConversationMessage } from '@/lib/conversations/process-conversation-message';
import { migrateContext, setFact } from '@/lib/workflows/context';

const model = vi.hoisted(() => ({ text: '', create: vi.fn() }));
vi.mock('openai', () => ({ default: class {
  responses = { create: model.create };
  embeddings = { create: async () => ({ data: [] }) };
} }));

it('R3 validated reply precedes history and real PostgreSQL send preparation, retaining CAS and isolation', async () => {
  expect(project).toBe('agjenti-e2e-local-recovery-3a-20261023'); verifyContainers();
  const keys = localKeys(), fixture = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
  const tenant = fixture.tenants.find((t: { kind: string }) => t.kind === 'information');
  const foreign = fixture.tenants.find((t: { kind: string }) => t.kind === 'retail');
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(input instanceof Request ? input.url : String(input)).origin !== keys.api) throw Error('EXTERNAL_NETWORK_FORBIDDEN');
    return original(input, init);
  });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', keys.api); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', keys.service);
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', fixture.encryptionKey);
  vi.stubEnv('MODULE_ENFORCEMENT_BUSINESS_IDS', tenant.id);
  vi.stubEnv('SHARED_WORKFLOW_BUSINESS_IDS', tenant.id);
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-non-network-provider');
  model.create.mockImplementation(async () => ({ id: 'rejected-provider-history', output_text: model.text }));
  const effects = () => sql(`select json_build_array((select count(*) from public.orders),(select count(*) from public.order_submissions),
    (select count(*) from public.bookings),(select count(*) from public.customers),(select count(*) from public.workflow_inbound_queue),
    (select count(*) from public.workflow_booking_effects),(select count(*) from public.integrations),(select count(*) from public.messages));`);
  const before = effects();
  const member = createClient(keys.api, keys.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    expect((await member.auth.signInWithPassword({ email: tenant.email, password: fixture.password })).error).toBeNull();
    const forbidden = await member.from('products').select('id').eq('business_id', foreign.id);
    expect(forbidden.error).toBeNull(); expect(forbidden.data).toEqual([]);
    const initial = migrateContext(); setFact(initial, 'customer_name', 'Synthetic R3', 'text', 'message_label');
    const snapshot = structuredClone(initial);
    model.text = 'Rezervimi u konfirmua për nesër.';
    const turn = await processConversationMessage({ businessId: tenant.id, state: initial, message: 'Përshëndetje', hasPhoto: false, mode: 'test' });
    expect(model.create).toHaveBeenCalled();
    expect(turn.reply).toContain('Nuk kam konfirmim');
    expect(turn.previousResponseId).toBeNull();
    expect(turn.nextState.recentMessages?.at(-1)?.content).toBe(turn.reply);
    expect(JSON.stringify(turn.nextState)).not.toContain(model.text);
    expect(initial).toEqual(snapshot);
    expect(turn.nextState.context?.profile.name?.value).toBe('Synthetic R3');
    model.text = 'Nuk ma ke treguar emrin.';
    const recall = await processConversationMessage({ businessId: tenant.id, state: turn.nextState, message: 'Si quhem?', hasPhoto: false, mode: 'test' });
    expect(recall.reply).toBe('Ti ke deklaruar emrin: Synthetic R3.');
    expect(recall.nextState.recentMessages?.at(-1)?.content).toBe(recall.reply);
    // P1: the same real coordinator path must persist a composite, not a false
    // absence claim. Facts here are synthetic and remain conversation-local.
    const { extractCustomerDeclaredFacts } = await import('@/lib/workflows/customer-declared-facts');
    extractCustomerDeclaredFacts(recall.nextState, 'Instagram: synthetic_p1; Lloji i biznesit: Shitje librash online');
    model.text = 'Nuk më ke dhënë asnjë të dhënë.';
    const composite = await processConversationMessage({ businessId: tenant.id, state: recall.nextState,
      message: 'Më kujto emrin, biznesin dhe Instagramin.', hasPhoto: false, mode: 'test' });
    for (const value of ['Synthetic R3', 'synthetic_p1', 'Shitje librash online']) expect(composite.reply).toContain(value);
    expect(composite.nextState.recentMessages?.at(-1)?.content).toBe(composite.reply);
    // Actual production SQL boundary, synthetic channel rows and complete rollback.
    const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
    sql(`begin; set local lock_timeout='5s'; set local statement_timeout='10s';
      do $test$ declare c uuid:=gen_random_uuid(); channel_id uuid:=gen_random_uuid(); q public.workflow_inbound_queue;
        state jsonb:=${json(composite.nextState)}; answer text:=${quote(composite.reply)};
      begin
        insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext) values(channel_id,${quote(tenant.id)},channel_id::text,'synthetic-only');
        insert into public.conversations(id,business_id,instagram_participant_id,instagram_connection_id,auto_reply,status)
          values(c,${quote(tenant.id)},c::text,channel_id,true,'active');
        insert into public.conversation_states(conversation_id,business_id) values(c,${quote(tenant.id)});
        insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
          values(${quote(tenant.id)},channel_id,c::text,c::text,'{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
        perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,state,null,answer,null,false);
        if (select collected from public.conversation_states where conversation_id=c) is distinct from state
          or (select reply from public.workflow_inbound_queue where id=q.id) is distinct from answer then raise exception 'validated_reply_roundtrip_failed'; end if;
        update public.workflow_inbound_queue set status='ignored' where id=q.id;
        insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
          values(${quote(tenant.id)},channel_id,c::text,c::text||'-2','{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
        begin
          perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,state,null,'STALE_UNVALIDATED_TEXT',null,false);
          raise exception 'stale_accepted' using errcode='XX001';
        exception when raise_exception then if sqlerrm<>'stale_state' then raise; end if; end;
      end $test$; rollback;`);
    expect(effects()).toBe(before);
    await member.auth.signOut();
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});
