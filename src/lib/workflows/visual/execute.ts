import { extractMessageFacts, profileExtractionFields } from "../extract-facts";
import { getFact, setFact, resetOrder, isQuestion, recordPrompt } from "../context";
import { agentModel } from "@/lib/agents/generate";
import type { AgentTurnParams, AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { emptyState } from "../engine";
import { advanceVisualWorkflow, detectVisualIntent } from "./runtime";
import { loadVisualVersion } from "./store";
import { validateVisualGraph } from "./model";

type Legacy = (params: AgentTurnParams & { informational?: string; requireConfiguredWorkflow?: boolean }) => Promise<AgentTurnResult>;

export async function executeVisualTurn(params: AgentTurnParams, legacy: Legacy): Promise<AgentTurnResult> {
  if (params.visualPreview && (params.mode !== "test" || params.visualPreview.businessId !== params.businessId)) throw new Error("invalid_workflow_preview");
  const previous = params.state?.visual;
  // Publishing the visual layer must not interrupt an existing linear product order.
  if (!params.visualPreview && !previous && params.state?.product_id && params.state.step_key !== "order_ready") return legacy(params);
  const active = previous && previous.status !== "completed" ? previous : null;
  const version = params.visualPreview ?? await loadVisualVersion(params.businessId, active?.versionId);
  if (!version) {
    if (active) throw new Error("missing_workflow_version");
    return legacy(params);
  }
  if (version.businessId !== params.businessId || !validateVisualGraph(version.graph).graph) throw new Error("invalid_visual_workflow");
  const started = Date.now();
  // Completion does not erase order/customer data. Only entering a new product flow resets it.
  let base = structuredClone(params.state ?? emptyState());
  const intent = detectVisualIntent(params.message);
  if(base.context && !active && base.product_id && intent==="order") base=resetOrder(base);
  let currentState=base;
  const extracted=base.context ? await extractMessageFacts(base,params.message,[...profileExtractionFields,...version.graph.nodes.filter(n=>n.kind==='collect').map(n=>({key:n.config.fieldKey!,type:n.config.fieldType||"text" as const,label:n.label}))]) : 0;
  const sharedValues = () => currentState.context ? Object.fromEntries(version.graph.nodes.filter(n=>n.config.fieldKey).flatMap(n=> {
    const fact=getFact(currentState,n.config.fieldKey!); return fact ? [[n.config.fieldKey!,fact.value]] : [];
  })) : undefined;
  const advance: typeof advanceVisualWorkflow = input => advanceVisualWorkflow({ ...input, sharedValues: sharedValues() });
  let execution = advance({ graph: version.graph, versionId: version.id, state: active,
    message: params.message, hasPhoto: params.hasPhoto, intent, ...(extracted?{inputAvailable:false}:{}) });
  const traversed = [...execution.traversedNodeIds];
  const replies: string[] = [];
  let productCalled = false, finished = false;
  let turn: AgentTurnResult = {
    reply: "", nextState: base, previousResponseId: null, workflowId: null, productName: null, workflowProgress: [],
    debug: { model: agentModel(), source: "fallback", fallbackReason: "workflow_prompt", agentConfigured: false,
      knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 },
  };
  for (let count = 0; count < 32; count++) {
    const action = execution.action;
    turn.nextState.visual = execution.state;
    if(turn.nextState.context) for(const node of version.graph.nodes.filter(n=>n.kind==='collect')) {
      const value=execution.state.values[node.config.fieldKey!];
      if(value) setFact(turn.nextState,node.config.fieldKey!,value,node.config.fieldType||"text",`visual:${node.id}`);
    }
    if (action.kind === "knowledge") {
      turn = await legacy({ ...params, state: turn.nextState, informational: action.message ?? "" });
      currentState=turn.nextState;
      replies.push(turn.reply);
      execution = advance({ graph: version.graph, versionId: version.id, state: execution.state,
        message: "", hasPhoto: false, intent, inputAvailable: false });
      traversed.push(...execution.traversedNodeIds);
      continue;
    }
    if (action.kind === "product") {
      const continuing = active?.nodeId === action.nodeId && active.awaiting && !productCalled;
      if (!continuing) {
        turn.nextState = { ...(turn.nextState.context ? (base.product_id ? resetOrder(turn.nextState) : turn.nextState) : emptyState()), visual: execution.state, completedVisual: base.completedVisual };
      }
      currentState=turn.nextState;
      // A loop back to a product starts a fresh selection on the NEXT incoming message.
      if (productCalled) { replies.push("Cilin produkt dëshironi?"); finished = true; break; }
      productCalled = true;
      turn = await legacy({ ...params, message: execution.inputConsumed && (!extracted || continuing) ? "" : params.message,
        hasPhoto: !execution.inputConsumed && params.hasPhoto, state: turn.nextState, previousResponseId: continuing ? params.previousResponseId : null,
        requireConfiguredWorkflow: true });
      currentState=turn.nextState;
      replies.push(turn.reply);
      if (turn.handoff) { execution.state.status = "handoff"; execution.state.awaiting = false; finished = true; break; }
      if (turn.nextState.step_key !== "order_ready") { finished = true; break; }
      execution = advance({ graph: version.graph, versionId: version.id, state: execution.state,
        message: "", hasPhoto: false, intent, productComplete: true, inputAvailable: false });
      traversed.push(...execution.traversedNodeIds);
      continue;
    }
    if (action.kind === "prompt" && base.context && isQuestion(params.message)) {
      const answer = await legacy({ ...params, state: turn.nextState, informational: "Përgjigju pyetjes pa ndryshuar të dhënat e porosisë." });
      replies.push(answer.reply);
    }
    if(action.kind==="prompt") recordPrompt(turn.nextState,action.nodeId);
    if (action.message) replies.push(action.message);
    if (action.kind === "end" && !replies.length) replies.push("Faleminderit. Të dhënat u plotësuan.");
    if (action.kind === "handoff") turn.handoff = true;
    finished = true;
    break;
  }
  if (!finished) throw new Error("workflow_execution_limit");
  turn.nextState.visual = execution.state;
  if (execution.state.status === "completed" || execution.state.status === "handoff") turn.nextState.completedVisual = structuredClone(execution.state);
  turn.reply = replies.join("\n\n");
  turn.visualWorkflow = { graph: version.graph, state: execution.state, traversedNodeIds: traversed };
  turn.debug.elapsedMs = Date.now() - started;
  params.onTrace?.({ stage: "workflow", label: "Visual workflow executed", data: {
    workflowName: version.graph.name, versionId: version.id, intent, method: "Deterministic intent rules",
    state: execution.state, traversedNodeIds: traversed, action: execution.action, preview: Boolean(params.visualPreview),
  } });
  return turn;
}
