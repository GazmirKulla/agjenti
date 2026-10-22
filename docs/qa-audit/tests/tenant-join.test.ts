import { beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const m = vi.hoisted(() => ({ from: vi.fn(), conversations: 0, customerTenant: 'tenant-b', filters: [] as [string, unknown][] }));
vi.mock('@/lib/supabase/service', () => ({ createServiceSupabase: () => ({ from: m.from }) }));
vi.mock('@/lib/dashboard/language/server', () => ({ getDashboardTranslator: async () => (s: string) => s }));
vi.mock('@/components/dashboard/language', () => ({ LocalizedStatusBadge: () => null }));
vi.mock('@/components/dashboard/inbox-refresh', () => ({ InboxRefresh: () => null }));
vi.mock('@/components/dashboard/add-customer-button', () => ({ AddCustomerButton: () => null }));
vi.mock('@/components/dashboard/inbox-list', () => ({ InboxList: ({ rows }: { rows: { name: string }[] }) => createElement('nav', {}, rows.map(r => r.name).join(' ')) }));
vi.mock('@/app/b/[slug]/inbox/[conversationId]/thread-client', () => ({ ThreadClient: () => null }));
vi.mock('@/components/dashboard/ui', () => ({ EmptyState: () => null, PageHeading: () => null, formatDate: () => 'test date', money: () => '0' }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not found'); } }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never) }));
import { InboxWorkspace } from '@/components/dashboard/inbox-workspace';
beforeEach(() => {
  vi.clearAllMocks(); m.conversations = 0; m.customerTenant = 'tenant-b'; m.filters = [];
  m.from.mockImplementation((table: string) => {
    let data: unknown = [];
    if (table === 'instagram_connections' || table === 'whatsapp_connections') data = null;
    if (table === 'conversations') {
      m.conversations++;
      const customers = { business_id: m.customerTenant, display_name: 'FOREIGN_CUSTOMER_NAME', username: 'foreign-user', phone: 'FOREIGN_CUSTOMER_PHONE', created_at: '2026-10-01' };
      data = m.conversations === 1 ? [{ id: 'own-conversation', participant_display_name: 'Own participant', customers }] : {
        id: 'own-conversation', business_id: 'tenant-a', channel: 'instagram', status: 'active',
        customer_id: 'foreign-customer', participant_display_name: 'Own participant',
        customers,
      };
    }
    const q = { select: () => q, eq: (key: string, value: unknown) => { m.filters.push([key, value]); return q; }, neq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    return q;
  });
});
it('does not render a foreign customer embedded through a tenant-owned conversation', async () => {
  // Synthetic inconsistent association, permitted by the reviewed single-column
  // FK + business_id-only write policy. No live DB mutation or exploit performed.
  const element = await InboxWorkspace({ businessId: 'tenant-a', slug: 'tenant-a', conversationId: 'own-conversation' });
  const html = renderToStaticMarkup(element);
  expect(html).not.toContain('FOREIGN_CUSTOMER_PHONE');
  expect(html).not.toContain('FOREIGN_CUSTOMER_NAME');
  expect(html).toContain('Own participant');
  expect(m.filters.filter(([key]) => key === 'customers.business_id')).toEqual([
    ['customers.business_id', 'tenant-a'], ['customers.business_id', 'tenant-a'],
  ]);
});
it('still renders the linked customer when both parent and child belong to the tenant', async () => {
  m.customerTenant = 'tenant-a';
  const html = renderToStaticMarkup(await InboxWorkspace({ businessId: 'tenant-a', slug: 'tenant-a', conversationId: 'own-conversation' }));
  expect(html).toContain('FOREIGN_CUSTOMER_PHONE');
  expect(html).toContain('FOREIGN_CUSTOMER_NAME');
});
