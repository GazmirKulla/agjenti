// R1: real local Auth/application/sealed state and PostgreSQL; no LLM call.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import path from 'node:path';
import { work, verifyContainers, localKeys, sql, project } from './local.mjs';
import { quote, json } from './fixtures.mjs';
import { observeServerActions, readServerAction } from './flight.mjs';

const fixtures = JSON.parse(readFileSync(path.join(work, 'fixtures.json'), 'utf8'));
const keys = localKeys(), origin = 'http://localhost:3103';
const t = fixtures.tenants.find(t => t.kind === 'information');
function decode(token) {
  const [, iv, tag, data] = token.split('.');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(fixtures.encryptionKey, 'hex'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString()).state;
}
function counts() {
  return sql(`select json_build_array((select count(*) from public.orders),(select count(*) from public.bookings),
    (select count(*) from public.customers),(select count(*) from public.workflow_inbound_queue),
    (select count(*) from public.integrations),(select count(*) from public.messages));`);
}
function roundtrip(state) {
  // No lasting fixtures, messages, credentials, jobs or business effects. The actual
  // transport RPC must retain the JSON without promoting it to reusable profiles.
  sql(`begin; set local lock_timeout='5s'; set local statement_timeout='10s';
    do $test$ declare c uuid:=gen_random_uuid(); channel_id uuid:=gen_random_uuid(); q public.workflow_inbound_queue;
      supplied jsonb:=${json(state)}; other_business uuid:=${quote(fixtures.tenants.find(x => x.kind === 'retail').id)};
    begin
      insert into public.instagram_connections(id,business_id,ig_user_id,access_token_ciphertext) values(channel_id,${quote(t.id)},channel_id::text,'synthetic-only');
      insert into public.conversations(id,business_id,instagram_participant_id,instagram_connection_id,auto_reply,status)
        values(c,${quote(t.id)},c::text,channel_id,true,'active');
      insert into public.conversation_states(conversation_id,business_id) values(c,${quote(t.id)});
      insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
        values(${quote(t.id)},channel_id,c::text,c::text,'{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
      perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,supplied,null,'Synthetic reply',null,false);
      if (select collected from public.conversation_states where conversation_id=c) is distinct from supplied then raise exception 'r1_roundtrip_failed'; end if;
      if exists(select 1 from public.conversation_profiles where business_id=${quote(t.id)} and participant_id=c::text
        and (profile::text like '%instagram_handle%' or profile::text like '%business_type%' or profile::text like '%stated_needs%')) then raise exception 'r1_profile_leak'; end if;
      if exists(select 1 from public.conversation_states where business_id=other_business and conversation_id=c) then raise exception 'r1_tenant_leak'; end if;
      update public.workflow_inbound_queue set status='ignored' where id=q.id;
      insert into public.workflow_inbound_queue(business_id,connection_id,participant_id,external_id,payload,conversation_id,status,lease_token,leased_until)
        values(${quote(t.id)},channel_id,c::text,c::text||'-2','{}',c,'processing',gen_random_uuid(),now()+interval '2 minutes') returning * into q;
      begin
        perform public.prepare_workflow_reply(q.id,q.lease_token,c,0,supplied,null,'Stale',null,false);
        raise exception 'r1_stale_accepted' using errcode='XX001';
      exception when raise_exception then if sqlerrm<>'stale_state' then raise; end if; end;
      delete from public.conversations where id=c;
      if exists(select 1 from public.conversation_states where conversation_id=c) then raise exception 'r1_deletion_failed'; end if;
    end $test$; rollback;`);
}
test.beforeAll(() => { expect(project).toBe('agjenti-e2e-local-recovery-3a-20261023'); verifyContainers(); });
test.beforeEach(async ({ page, context }) => {
  await observeServerActions(page);
  await context.route('**/*', r => [origin, keys.api].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort());
  await context.routeWebSocket('**/*', r => new URL(r.url()).origin === 'ws://localhost:3103' ? r.connectToServer() : r.close());
});
test('R1 authenticated declarations survive 25 turns, corrections, reload and real SQL CAS without profile promotion', async ({ page }) => {
  test.setTimeout(120000);
  const before = counts();
  await page.goto('/login'); await page.getByLabel('Email-i', { exact: true }).fill(t.email);
  await page.getByPlaceholder('Fjalëkalimi yt', { exact: true }).fill(fixtures.password);
  await page.getByRole('button', { name: 'Hyr në panel →', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/b/${t.slug}`); await page.goto(`/b/${t.slug}/agents/test`);
  async function send(message) {
    const input = page.locator('#agent-test-message'); await input.fill(message);
    const { result } = await readServerAction(page, () => input.press('Enter'));
    expect(result.error).toBeUndefined(); const turn = result.turn ?? result;
    await expect(page.getByText(turn.reply, { exact: true }).last()).toBeVisible();
    expect(turn.debug?.source).not.toBe('ai');
    return decode(result.session);
  }
  let state = await send('Quhem Synthetic'); expect(state.context.profile.name.value).toBe('Synthetic');
  state = await send('Instagram: synthetic_shop; Lloji i biznesit: online clothing store; Pyetjet tipike: prices, sizes and orders');
  expect(state.customerDeclaredFacts.instagram_handle.value).toBe('synthetic_shop');
  for (let i=0; i<25; i++) state = await send(`Çfarë informacioni keni? ${i}`);
  expect(state.recentMessages).toHaveLength(10); expect(JSON.stringify(state.recentMessages)).not.toContain('synthetic_shop');
  await page.reload();
  state = await send('Profili im në Instagram është corrected_shop');
  state = await send('Çfarë të kam thënë më parë?');
  expect(state.customerDeclaredFacts).toMatchObject({ instagram_handle: { value: 'corrected_shop', source: 'customer_declaration' },
    business_type: { value: 'online clothing store' }, stated_needs: { value: 'prices, sizes and orders' } });
  expect(state.context.profile).not.toHaveProperty('instagram_handle');
  expect(state.context.order).not.toHaveProperty('business_type');
  expect(state.context.profile.name.value).toBe('Synthetic');
  roundtrip(state); expect(counts()).toBe(before);
  await test.info().attach('r1-boundaries', { body: Buffer.from(JSON.stringify({ turns: 30, historyMessages: state.recentMessages.length,
    canonicalKeys: Object.keys(state.customerDeclaredFacts), sqlRoundtrip: true, staleRevisionRejected: true, deletionVerified: true,
    reusableProfilePromotion: false, businessEffectsUnchanged: true, realModelCalled: false })), contentType: 'application/json' });
});
