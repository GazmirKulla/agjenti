"use client";
import type { VisualTrace } from "@/lib/workflows/visual/types";
import { WorkflowHub, WorkflowContextPanel, type WorkflowHubProps } from "./workflow-hub";
import "./visual-workflow.css";

export function MessageRoutingView({ trace, state, message }: { trace?: VisualTrace } & Pick<WorkflowHubProps, "state" | "message">) {
  return <div className="vf-message-routing">
    <WorkflowHub graph={trace?.graph} trace={trace} state={state} message={message} compact />
    {state && <details className="vf-routing-context"><summary>Konteksti dhe proceset e ruajtura</summary><WorkflowContextPanel state={state} /></details>}
  </div>;
}
