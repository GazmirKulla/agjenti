import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DashboardLanguageProvider } from "@/components/dashboard/language";
import { ThreadClient } from "./thread-client";

vi.mock("@/components/agents/message-reactions.module.css", () => ({ default: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const message = (id: string, body: string) => ({ id, direction: "inbound", source: "customer", body, media: null, created_at: "2026-11-27T01:06:00Z", delivery_status: null, delivery_error: null });
const render = (escalations?: { messageId: string; reason: string; handedOff: boolean }[]) => renderToStaticMarkup(h(DashboardLanguageProvider, { language: "sq", children:
  h(ThreadClient, { userId: "u", businessId: "b", conversationId: "c", slug: "s", status: "active", channel: "instagram", customerName: "Klienti", logs: [],
    messages: [message("11111111-1111-4111-8111-111111111111", "Ndryshoje e pra"), message("22222222-2222-4222-8222-222222222222", "ok")], escalations }) }));

it("marks the customer message where the agent understood that the customer needs a person, and only that one", () => {
  const html = render([{ messageId: "11111111-1111-4111-8111-111111111111", reason: "dissatisfied", handedOff: true }]);
  expect(html).toContain("Këtu Agjenti kuptoi që klientit i duhet një person · i pakënaqur · ia kaloi stafit");
  expect(html.match(/is-escalation/g)).toHaveLength(1);
  expect(html.indexOf("is-escalation")).toBeLessThan(html.indexOf("Ndryshoje e pra"));
});

it("shows nothing extra without an escalation", () => {
  expect(render()).not.toContain("chat-escalation");
});
