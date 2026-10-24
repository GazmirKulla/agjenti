import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DashboardLanguageProvider } from "@/components/dashboard/language";
import { MessageReactions, type useMessageReactions } from "./message-reactions";
import type { MessageReaction } from "@/lib/conversations/reactions";
vi.mock("./message-reactions.module.css", () => ({ default: {} }));
type Controller = ReturnType<typeof useMessageReactions>;
const reaction: MessageReaction = { id: "r", messageId: "m", partId: null, actor: "business", emoji: "👍", ambiguous: false, revision: 2, requestId: "request", requestedEmoji: "❤️", status: "failed", error: null, attempt: 1, canRetry: true };
function render(channel: string, changes: Partial<Controller> = {}) {
  const controller: Controller = { reactions: [reaction], ready: true, error: null, unresolved: null, posting: false, refresh: vi.fn(async () => {}), retryUnresolved: vi.fn(), send: vi.fn(async () => {}), retry: vi.fn(), ...changes };
  return renderToStaticMarkup(h(DashboardLanguageProvider, { language: "en", children: h(MessageReactions, { messageId: "m", channel, eligible: true, controller }) }));
}
it("pending replacement preserves the previous emoji without announcing the old failure as the new outcome", () => {
  const html = render("instagram", { posting: true, unresolved: { messageId: "m", requestId: "new", emoji: "❤️", revision: 2 } });
  expect(html).toContain("Sending reaction…");
  expect(html).toContain("👍");
  expect(html).not.toContain("Reaction failed.");
  expect(html).not.toContain("Retry the same reaction");
});
it("uncertain outcome is explicit and does not offer a blind retry", () => {
  const html = render("instagram", { reactions: [{ ...reaction, status: "uncertain", canRetry: false }] });
  expect(html).toContain("Reaction outcome unknown; it will not be resent.");
  expect(html).not.toContain("Retry the same reaction");
});
it("unsupported WhatsApp removal stays visibly disabled; customer reactions are not editable buttons", () => {
  const html = render("whatsapp", { reactions: [{ ...reaction, status: "sent", canRetry: false }, { ...reaction, id: "customer", actor: "customer", status: null, emoji: "😊", canRetry: false }] });
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remove reaction<\/button>/);
  expect(html).toContain("Removal is not enabled for this channel.");
  expect(html).toMatch(/<span[^>]*title="Customer reaction"[^>]*>😊/);
});
it("unknown channels never expose an actionable emoji picker", () => {
  const html = render("unsupported", { reactions: [] });
  expect(html).not.toContain("<details");
  expect(html).not.toContain("<button");
});
