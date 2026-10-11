import { expect, it } from "vitest";
import { inboxHistory, type InboxHistoryMessage } from "./inbox-history";
const row = (body: string, source = "customer", delivery_status = "sent", external_message_id = body): InboxHistoryMessage => ({ body, source, direction: source === "customer" ? "inbound" : "outbound", delivery_status, external_message_id });

it("keeps staff and paused customer context, excluding this batch and failed output", () => {
  const history = inboxHistory([
    row("Vazhdo"), row("Ju lutem"), row("Adresa u sqarua", "staff"), row("Nuk mbërriti", "staff", "failed"),
    row("Kam një pyetje tjetër"), row("Biseda iu kalua stafit", "agent"), row("Dua staf"),
  ], new Set(["Vazhdo", "Ju lutem"]));
  expect(history.staffReplied).toBe(true);
  expect(history.messages).toEqual([
    { role: "user", content: "Dua staf" }, { role: "assistant", content: "Biseda iu kalua stafit" },
    { role: "user", content: "Kam një pyetje tjetër" }, { role: "assistant", content: "[Stafi] Adresa u sqarua" },
  ]);
});
it("does not mistake an older staff reply for a new takeover after AI has replied", () => {
  expect(inboxHistory([row("Vazhdojmë", "agent"), row("Stafi", "staff")], new Set()).staffReplied).toBe(false);
});
it("retains the existing history bounds", () => {
  const history = inboxHistory(Array.from({ length: 30 }, (_, i) => row(`${i}`.repeat(1500))), new Set());
  expect(history.messages).toHaveLength(10);
  expect(history.messages.every(message => message.content.length === 1200)).toBe(true);
});
