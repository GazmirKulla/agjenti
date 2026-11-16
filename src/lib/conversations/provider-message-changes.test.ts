import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: vi.fn() }));
import { parseProviderMessageChanges } from "./provider-message-changes";

const now = Date.UTC(2026, 10, 16, 12);
const ig = (event: Record<string, unknown>, { sender = "customer", recipient = "account", time = now } = {}) =>
  ({ object: "instagram", entry: [{ id: "account", messaging: [{ sender: { id: sender }, recipient: { id: recipient }, timestamp: time, ...event }] }] });

it("reads a customer unsend and a customer edit, in both webhook envelopes", () => {
  expect(parseProviderMessageChanges(ig({ message: { mid: "m1", is_deleted: true } }), now)).toEqual([
    { channel: "instagram", accountId: "account", participantId: "customer", messageId: "m1", deleted: true, text: null, occurredAt: new Date(now).toISOString() },
  ]);
  expect(parseProviderMessageChanges(ig({ message_edit: { mid: "m2", text: "Masa M, jo L", num_edit: 2 } }), now)).toEqual([
    expect.objectContaining({ messageId: "m2", deleted: false, text: "Masa M, jo L" }),
  ]);
  const viaChanges = { object: "instagram", entry: [{ id: "account", changes: [{ field: "message_edit", value: { sender: { id: "customer" }, recipient: { id: "account" }, timestamp: now, message_edit: { mid: "m3", text: "" } } }] }] };
  // An edit to empty text is still the customer's latest version.
  expect(parseProviderMessageChanges(viaChanges, now)).toEqual([expect.objectContaining({ messageId: "m3", text: "" })]);
});

it("ignores business unsends, foreign recipients, stale or future events, other channels and malformed ids", () => {
  const cases = [
    ig({ message: { mid: "m1", is_deleted: true } }, { sender: "account", recipient: "customer" }),
    ig({ message: { mid: "m1", is_deleted: true, is_echo: true } }),
    ig({ message: { mid: "m1", is_deleted: true } }, { recipient: "someone-else" }),
    ig({ message: { mid: "m1", is_deleted: true } }, { time: now - 8 * 86400000 }),
    ig({ message: { mid: "m1", is_deleted: true } }, { time: now + 600000 }),
    ig({ message: { mid: "", is_deleted: true } }),
    ig({ message_edit: { mid: "m2" } }),
    ig({ message_edit: { mid: "m2", text: "x".repeat(4097) } }),
    ig({ message: { mid: "m4", text: "a new message, not a change" } }),
    { object: "whatsapp_business_account", entry: [{ id: "account", messaging: [{ sender: { id: "customer" }, recipient: { id: "account" }, timestamp: now, message: { mid: "m1", is_deleted: true } }] }] },
  ];
  for (const payload of cases) expect(parseProviderMessageChanges(payload, now)).toEqual([]);
});
