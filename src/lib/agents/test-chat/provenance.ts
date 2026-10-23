import type { TraceObserver } from "@/lib/conversations/trace";
import type { AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import type { AgentConfigurationRead, TestConfigurationProvenance } from "../configuration-contract";

/** Request-local projection of trusted runtime events, NOT a second configuration read.
 * Never forwards arbitrary trace data (which can include private prompts). */
export function collectTestConfiguration(previewId?: string) {
  const agents: TestConfigurationProvenance["agents"] = [];
  let workflow: TestConfigurationProvenance["workflow"] = {
    id: null, versionId: previewId ?? null, mode: previewId ? "draft" : "unavailable",
  };
  const onTrace: TraceObserver = event => {
    if (event.stage === "context" && event.label === "Customer agent configuration loaded") {
      const a = event.data?.agentConfiguration as AgentConfigurationRead | undefined;
      if (!a) return;
      agents.push({ agentId: a.agentId, agentName: a.agentName, active: a.active,
        instructionHash: a.instructionHash, readAt: a.readAt, instructionSource: a.instructionSource,
        fallbackReason: a.fallbackReason, generationRequested: false, fallbackInstructionsUsed: null });
    }
    if (event.stage === "ai" && event.label === "AI request sent") {
      const agent = agents.at(-1);
      if (agent) { agent.generationRequested = true; agent.fallbackInstructionsUsed = agent.instructionSource === "base"; }
    }
    if (event.stage === "workflow" && ["Visual workflow executed", "Workflow resolved"].includes(event.label)) {
      const d = event.data;
      const mode = d?.workflowSource;
      workflow = { id: typeof d?.workflowId === "string" ? d.workflowId : null,
        versionId: typeof d?.versionId === "string" ? d.versionId : null,
        mode: mode === "draft" || mode === "published" || mode === "pinned" ? mode : "unavailable" };
    }
  };
  return { onTrace, finish: (turn: Pick<AgentTurnResult, "debug">): TestConfigurationProvenance => ({
    agents, workflow, responseSource: turn.debug?.source ?? "unavailable",
    responseFallbackReason: turn.debug?.fallbackReason ?? null, behaviorVerified: false,
  }) };
}
