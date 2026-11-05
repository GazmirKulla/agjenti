"use client";
import { useState } from "react";
import type { ChatEntry, TestConversation } from "@/components/agents/chat-history";
import type { TraceStage } from "@/lib/conversations/trace";
import type { LabTurn } from "@/lib/chat-lab/model";
import { workflowFields } from "@/lib/chat-lab/model";
import type { WorkflowStepDef } from "@/lib/workflows/engine";
import { Inspector, Raw } from "./inspector";

export function ConversationInspector({ entry, chat }: { entry?: ChatEntry; chat: TestConversation }) {
  const [tab, setTab] = useState<TraceStage>("overview");
  const observation = entry?.result.labObservation;
  const trace = observation?.trace ?? [];
  const linear = [...trace].reverse().find(event => event.label === "Workflow resolved" && event.status !== "error" && event.status !== "skipped");
  const turn: LabTurn | undefined = entry ? {
    ...entry.result, input: entry.batchId ? chat.entries.filter(item => item.batchId === entry.batchId).map(item => item.text).join("\n") : entry.text,
    trace, timestamp: observation?.timestamp ?? "", testConversationId: chat.id, replaySession: "",
    fields: workflowFields(entry.result.nextState, (linear?.data?.steps ?? []) as WorkflowStepDef[]),
    warnings: [...(entry.result.debug.fallbackReason ? [entry.result.debug.fallbackReason] : []), ...trace.filter(event => event.status === "error").map(event => event.label)],
  } : undefined;
  const failed = chat.outbox?.find(operation => operation.status === "failed");
  return <aside id="lab-conversation-inspector" className="lab-inspector panel" aria-label="Inspektori i bisedës">
    <div className="lab-panel-heading"><div><h2>Conversation Inspector</h2><p className="lab-muted">{entry ? `Mesazhi ${chat.entries.indexOf(entry) + 1} · ${chat.mode === "real" ? "REAL" : "PROVË"}` : "Zgjidh një mesazh"}</p></div></div>
    {entry && !observation && <p className="lab-warning" role="status">Ky mesazh nuk ka gjurmë të regjistruara. Gjendja e ruajtur nuk është provë ekzekutimi. Dërgo një mesazh të ri për të regjistruar gjurmët.</p>}
    <Inspector turn={turn} failure={failed ? { error: failed.error ?? "Kërkesa dështoi.", trace: failed.failure?.trace } : undefined} tab={tab} onTab={setTab} />
    <details className="lab-raw"><summary>Conversation Data · biseda aktuale</summary>
      <Raw value={{ conversationId: chat.id, mode: chat.mode ?? "test", state: chat.entries.at(-1)?.result.nextState ?? null,
        pending: chat.outbox?.map(operation => ({ id: operation.id, status: operation.status, error: operation.error })) ?? [] }} />
    </details>
  </aside>;
}
