import { expect, it } from "vitest";
import { inboundBatch } from "./message-batch";
import type { NormalizedIncomingMessage } from "@/lib/instagram/types";
import type { WorkflowJob } from "./workflow-queue";
const first: NormalizedIncomingMessage = { channel: "instagram", externalMessageId: "first", externalParticipantId: "person", text: "Ckemi", attachments: [], timestamp: new Date(), contextMetadata: { instagramAccountId: "account" }, rawPayload: {}, phone: null, senderUsername: null, senderDisplayName: null };
const job = (payloads: NormalizedIncomingMessage[]): WorkflowJob => ({ id: 1, payload: first, participant_id: "person", business_id: "business", connection_id: "connection", status: "processing", lease_token: "lease", reply: null, batch_payloads: payloads });
it("retains media, originals and insertion order without mutating the frozen payloads", () => {
 const second = { ...first, externalMessageId: "second", text: "Kete produkt", attachments: [{ kind: "image" as const, externalMediaId: null, sourceUrl: "https://example.test/photo", mimeType: "image/png" }] };
 const frozen = [first, second];
 const result = inboundBatch(first, job(frozen));
 expect(result.message.text).toBe("Ckemi\nKete produkt");
 expect(result.message.attachments).toEqual(second.attachments);
 expect(result.originals.map(item => item.externalMessageId)).toEqual(["first", "second"]);
 expect(frozen[0].text).toBe("Ckemi");
});
it.each([
 { externalParticipantId: "other" },
 { contextMetadata: { instagramAccountId: "other-account" } },
 { channel: "whatsapp" as const },
 { externalMessageId: "first" },
 { timestamp: new Date(NaN) },
])("rejects invalid batch identity or timestamp (%j)", patch => {
 expect(() => inboundBatch(first, job([first, { ...first, externalMessageId: "second", ...patch }]))).toThrow();
});
it("rejects empty, oversized and wrong-leader batches", () => {
 for (const payloads of [[], Array(21).fill(first), [{ ...first, externalMessageId: "other" }]]) expect(() => inboundBatch(first, job(payloads))).toThrow();
});
