import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), access: vi.fn(), fetch: vi.fn(), updates: [] as unknown[] }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/tenant/access', () => ({ requireBusinessAccess: mocks.access }));
import { deliverMobileNotifications } from './notifications';
beforeEach(() => {
  vi.clearAllMocks(); mocks.updates.length = 0; vi.stubGlobal('fetch', mocks.fetch);
  mocks.rpc.mockResolvedValue({ data: [{ id: 'delivery', event_id: 'event', token: 'ExpoPushToken[test]', attempts: 1, receipt_id: null }], error: null });
  mocks.access.mockResolvedValue({ business: { id: 'business' } });
  const rows: Record<string, unknown> = { mobile_notification_events: { id: 'event', user_id: 'owner', business_id: 'business', conversation_id: 'conversation', kind: 'assistant' }, mobile_devices: { user_id: 'owner' }, businesses: { slug: 'one' }, assistant_conversations: { id: 'conversation' } };
  mocks.from.mockImplementation((table: string) => { const chain = { select: () => chain, eq: () => chain, is: () => chain, single: async () => ({ data: rows[table] }), maybeSingle: async () => ({ data: rows[table] }), update: (value: unknown) => { mocks.updates.push(value); return chain; }, delete: () => chain, then: (resolve: (v:unknown)=>unknown) => Promise.resolve({ error: null }).then(resolve) }; return chain; });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: 'ok', id: 'receipt' }] }) });
});
it('never sends after business membership is revoked', async () => { mocks.access.mockResolvedValue(null); await deliverMobileNotifications(); expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.updates).toContainEqual({ status: 'failed' }); });
it('sends references only, then waits for provider delivery receipts', async () => { await deliverMobileNotifications(); const body = JSON.parse(mocks.fetch.mock.calls[0][1].body); expect(body[0].data).toEqual({ eventId: 'event', businessId: 'business', conversationId: 'conversation' }); expect(mocks.updates).toContainEqual(expect.objectContaining({ status: 'receipt', receipt_id: 'receipt' })); });
it('keeps transient failures for retry without reporting delivery success', async () => { mocks.fetch.mockRejectedValue(Error('network')); await deliverMobileNotifications(); expect(mocks.updates).toContainEqual(expect.objectContaining({ status: 'pending' })); });
it('does not resend an accepted notification while checking its receipt', async () => { mocks.rpc.mockResolvedValue({ data: [{ id: 'delivery', event_id: 'event', token: 'ExpoPushToken[test]', attempts: 2, receipt_id: 'receipt' }], error: null }); mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { receipt: { status: 'ok' } } }) }); await deliverMobileNotifications(); expect(mocks.fetch.mock.calls[0][0]).toContain('getReceipts'); expect(mocks.updates).toContainEqual(expect.objectContaining({ status: 'sent' })); });
