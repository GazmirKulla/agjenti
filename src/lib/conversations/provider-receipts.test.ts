import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: vi.fn() }));
import { parseProviderReceipts } from "./provider-receipts";
const now = Date.UTC(2026,9,24,12);
const wa = (statuses: unknown[]) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123456" }, statuses } }] }] });
describe("official receipt envelopes, synthetic IDs", () => {
  it("keeps all WhatsApp status identities (including duplicates/out-of-order) for atomic DB reconciliation", () => {
    const result = parseProviderReceipts(wa(["read", "delivered", "sent", "read"].map(status => ({ id: "wamid.synthetic", recipient_id: "355690000000", status, timestamp: now / 1000 }))),now);
    expect(result.map(r=>r.status)).toEqual(["read", "delivered", "sent", "read"]);
    expect(result.every(r=>r.accountId === "123456" && r.participantId === "355690000000" && r.messageId === "wamid.synthetic")).toBe(true);
  });
  it("accepts an exact Instagram mid in messaging and messaging_seen changes without inventing delivery", () => {
    const event = { sender: {id:"person"}, recipient: {id:"account"}, timestamp:now, read:{mid:"synthetic-mid"} };
    for (const contents of [{ messaging:[event] }, { changes:[{field:"messaging_seen",value:event}] }]) {
      expect(parseProviderReceipts({object:"instagram",entry:[{id:"account",...contents}]},now)).toEqual([{channel:"instagram",accountId:"account",participantId:"person",messageId:"synthetic-mid",status:"read",occurredAt:new Date(now).toISOString()}]);
    }
  });
  it("rejects wrong-account, watermark-only, stale, future and malformed receipts", () => {
    expect(parseProviderReceipts({ object:"instagram", entry:[{id:"account",messaging:[{sender:{id:"person"},recipient:{id:"other"},read:{mid:"mid"},timestamp:now},{sender:{id:"person"},recipient:{id:"account"},read:{watermark:now},timestamp:now}]}]},now)).toEqual([]);
    for(const timestamp of ["invalid", 0, (now+600000)/1000]) expect(parseProviderReceipts(wa([{id:"mid",recipient_id:"person",status:"read",timestamp}]),now)).toEqual([]);
    expect(parseProviderReceipts(wa([{id:"mid",status:"read",timestamp:now/1000}]),now)).toEqual([]);
  });
});
