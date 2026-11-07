import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  access: vi.fn(),
  rpc: vi.fn(),
  conversations: vi.fn(),
}));
vi.mock("@/lib/auth/read-client", () => ({
  authenticatedReadClient: mocks.identity,
}));
vi.mock("@/lib/tenant/access", () => ({
  requireBusinessAccess: mocks.access,
}));
import { loadRecentInbox } from "./recent-inbox";

function db() {
  return {
    rpc: mocks.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: mocks.conversations,
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    user: { id: "owner" },
    db: db(),
  });
  mocks.access.mockResolvedValue({ business: { id: "biz-1", slug: "shop" } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.conversations.mockResolvedValue({ data: [], error: null });
});

it("refuses unauthenticated and cross-tenant reads", async () => {
  mocks.identity.mockResolvedValue(null);
  await expect(
    loadRecentInbox("shop", new Request("https://app.test/api/business-assistant/inbox")),
  ).rejects.toMatchObject({ status: 401 });
  mocks.identity.mockResolvedValue({ user: { id: "owner" }, db: db() });
  mocks.access.mockResolvedValue(null);
  await expect(
    loadRecentInbox("other", new Request("https://app.test/api/business-assistant/inbox")),
  ).rejects.toMatchObject({ status: 403 });
});

it("returns no conversations when Inbox is not allowed", async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  await expect(
    loadRecentInbox("shop", new Request("https://app.test/api/business-assistant/inbox")),
  ).resolves.toEqual({ conversations: [] });
  expect(mocks.conversations).not.toHaveBeenCalled();
});

it("keeps only this business's customer identity and three newest rows", async () => {
  mocks.conversations.mockResolvedValue({
    data: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        channel: "instagram",
        last_message_preview: "Pershendetje",
        last_message_at: "2026-11-07T10:00:00Z",
        unread_count: 2,
        participant_display_name: "Ana",
        participant_username: "ana",
        customers: { business_id: "biz-1", display_name: "Ana K", username: "ana" },
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        channel: "whatsapp",
        last_message_preview: "x".repeat(200),
        last_message_at: "2026-11-06T10:00:00Z",
        unread_count: 0,
        participant_display_name: "Ben",
        participant_username: null,
        customers: { business_id: "other", display_name: "Secret", username: "leak" },
      },
    ],
    error: null,
  });
  const result = await loadRecentInbox(
    "shop",
    new Request("https://app.test/api/business-assistant/inbox"),
  );
  expect(result.conversations).toEqual([
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Ana K",
      preview: "Pershendetje",
      unread: 2,
      channel: "instagram",
      updatedAt: "2026-11-07T10:00:00Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Ben",
      preview: "x".repeat(140),
      unread: 0,
      channel: "whatsapp",
      updatedAt: "2026-11-06T10:00:00Z",
    },
  ]);
});
