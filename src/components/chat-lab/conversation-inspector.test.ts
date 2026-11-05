import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationInspector } from "./conversation-inspector";
import type { ChatEntry, TestConversation } from "@/components/agents/chat-history";
import { emptyState } from "@/lib/workflows/state";
const entry = (id: string): ChatEntry => ({ id, text: `input-${id}`, photo: false, attachments: [], result: {
  session: "private-checkpoint", reply: `reply-${id}`, turns: 1, autoReplyEnabled: false,
  nextState: emptyState(), previousResponseId: null, workflowId: null, productName: null, workflowProgress: [],
  debug: { source: "ai", model: "test", fallbackReason: null, agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 10 },
  labObservation: { timestamp: "2026-11-05T12:00:00Z", trace: [{ stage: "workflow", label: "Visual workflow executed", elapsedMs: 8, data: { workflowName: `workflow-${id}`, versionId: `version-${id}` } }] },
} });
it("inspects the selected message rather than the latest one and excludes checkpoint tokens", () => {
 const first = entry("first"), last = entry("last");
 const chat: TestConversation = { id: "conversation", title: "Test", entries: [first, last], updatedAt: 1 };
 const html = renderToStaticMarkup(createElement(ConversationInspector, { entry: first, chat }));
 expect(html).toContain("version-first"); expect(html).not.toContain("version-last");
 expect(html).toContain("input-first"); expect(html).not.toContain("private-checkpoint");
});
it("does not fabricate traces for old history and shows failed attempts separately", () => {
 const old = entry("old"); delete old.result.labObservation;
 const chat: TestConversation = { id: "conversation", title: "Test", entries: [old], updatedAt: 1, outbox: [{ id: "failed", sequence: 1, text: "new", photo: false, attachments: [], session: null, status: "failed", error: "Failed request", failure: { timestamp: "now", trace: [{ stage: "ai", label: "Actual failed call", status: "error", elapsedMs: 5 }] } }] };
 const html = renderToStaticMarkup(createElement(ConversationInspector, { entry: old, chat }));
 expect(html).toContain("Ky mesazh nuk ka gjurmë të regjistruara");
 expect(html).toContain("Actual failed call"); expect(html).toContain("Failed request");
});
