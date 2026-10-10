import { chooseGuidance, clarification, invalidateConfirmation } from "../guidance";
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
  if (!params.visualPreview && !params.informationRequest && !params.bookingRequest && !previous && params.state?.product_id && params.state.step_key !== "order_ready") return legacy(params);
  let active = previous && previous.status !== "completed" ? previous : null;
  const loadedVersion = params.visualPreview ?? await loadVisualVersion(params.businessId, previous?.versionId);
  if (!loadedVersion) {
    if (active) throw new Error("missing_workflow_version");
    return legacy(params);
  }
  let version = loadedVersion;
  if (version.businessId !== params.businessId || !validateVisualGraph(version.graph).graph) throw new Error("invalid_visual_workflow");
  const started = Date.now();
  // Completion does not erase order/customer data. Only entering a new product flow resets it.
  let base = structuredClone(params.state ?? emptyState());
  let intent = params.bookingRequest ? "booking" as const : detectVisualIntent(params.message);
  let navigating = false;
  let revisiting = false;
  const currentNode = version.graph.nodes.find(n => n.id === previous?.nodeId);
  const routesFor = (graph: typeof version.graph) => {
    const flows = graph.version === 2 ? graph.flows : [];
    return graph.nodes.flatMap(n => {
      const flow = flows.find(flow => flow.entryNodeId === n.id);
      const processKind = flow?.kind === "order" ? "product" : flow?.kind === "booking" ? "booking" : flow?.kind === "support" ? "support_entry" : flow?.kind === "information" ? "knowledge" : undefined;
      if (processKind) return [{ id: n.id, label: flow!.label, prompt: n.config.prompt, fieldKey: n.config.fieldKey, kind: processKind }];
      // Process nodes are entered through their configured flow entry; inner collection
      // steps remain selectable for corrections after that task has begun.
      if (["product", "booking", "handoff", "knowledge"].includes(n.kind) && flows.some(flow => flow.nodeIds.includes(n.id))) return [];
      return ["collect", "confirm", "knowledge", "product", "booking", "handoff"].includes(n.kind)
        ? [{ id: n.id, label: n.label, prompt: n.config.prompt, fieldKey: n.config.fieldKey, kind: n.kind as string }]
        : n.kind === "condition" && n.config.condition === "intent_support"
          ? [{ id: n.id, label: n.label, prompt: n.config.prompt, fieldKey: n.config.fieldKey, kind: "support_entry" }] : [];
    });
  };
  let routes = routesFor(version.graph);
  const targets = (previous?.visited ?? []).flatMap(id => {
    const n = routes.find(n=>n.id===id);
    return n && n.id !== previous?.nodeId && ["collect","confirm","product"].includes(n.kind) ? [n] : [];
  });
  // The new message is evaluated before the saved cursor, including product and terminal states.
  const bookingNodes = routes.filter(node => node.kind === "booking");
  const bookingFlow = version.graph.version === 2 ? version.graph.flows.find(flow => flow.kind === "booking" && flow.nodeIds.includes(previous?.nodeId ?? "")) : undefined;
  const continuingBooking = params.bookingRequest && previous?.status === "waiting" && Boolean(bookingFlow || currentNode?.kind === "booking");
  const orderFlow = version.graph.version === 2 ? version.graph.flows.find(flow => flow.kind === "order" && flow.nodeIds.includes(previous?.nodeId ?? "")) : undefined;
  const continuingOrder = params.orderRequest && previous?.status === "waiting" && Boolean(orderFlow || currentNode?.kind === "product");
  const informationEntries = routes.filter(node => node.kind === "knowledge");
  const informationFlow = version.graph.version === 2 ? version.graph.flows.find(flow => flow.kind === "information" && flow.nodeIds.includes(previous?.nodeId ?? "")) : undefined;
  const continuingInformation = params.informationRequest && previous?.status === "waiting" && Boolean(informationFlow);
  const guidance = continuingBooking || continuingOrder || continuingInformation ? { action: "continue" as const, target: null, source: "rules" as const }
    : params.informationRequest && informationEntries.length === 1 ? { action: "route" as const, target: informationEntries[0].id, source: "rules" as const }
    : params.bookingRequest && bookingNodes.length === 1 ? { action: "route" as const, target: bookingNodes[0].id, source: "rules" as const } : await chooseGuidance({message:params.message,state:base,targets,routes,
    current:currentNode ? {id:currentNode.id,label:currentNode.label,prompt:currentNode.config.prompt,fieldKey:currentNode.config.fieldKey,kind:currentNode.kind} : undefined,
    allowOrder:routes.some(n=>n.kind==="product"), allowSupport:routes.some(n=>n.kind==="handoff" || n.kind==="support_entry"),
  });
  params.onTrace?.({stage:"workflow",label:"New message routed",data:{...guidance,from:previous?.nodeId??null,candidates:routes.map(r=>r.id)}});
  const freshState = () => ({versionId:version.id,nodeId:version.graph.nodes.find(n=>n.kind==="start")!.id,status:"running" as const,awaiting:false,visited:[],values:{}});
  if (guidance.action === "clarify" || (guidance.action === "answer" && previous)) {
    const answer = await legacy({...params,state:base,informational:"Answer the current question without advancing or repeating workflow questions."});
    answer.nextState = base;
    answer.workflowId = params.persistedWorkflowId ?? base.context?.execution.linear?.id ?? base.linearSnapshot?.id ?? answer.workflowId;
    if (guidance.action === "clarify") answer.reply = clarification(routes);
    const visual = previous ?? freshState();
    answer.nextState.visual = visual;
    answer.visualWorkflow = {graph:version.graph,state:visual,traversedNodeIds:[],routing:{action:guidance.action,from:previous?.nodeId??null,to:visual.nodeId,source:guidance.source}};
    return answer;
  }
  let destination = guidance.target;
  if (guidance.action === "answer" && !previous) destination = routes.find(n=>n.kind==="knowledge")?.id ?? null;
  if (guidance.action === "order" && previous?.status === "completed" && !params.visualPreview) {
    const latest = await loadVisualVersion(params.businessId);
    if (!latest) return legacy(params);
    if (latest.businessId !== params.businessId || !validateVisualGraph(latest.graph).graph) throw new Error("invalid_visual_workflow");
    version = latest;
    routes = routesFor(version.graph);
    const products = routes.filter(n=>n.kind==="product");
    destination = products.length === 1 ? products[0].id : null;
    if (!destination) {
      const answer = await legacy({...params,state:base,informational:"Ask which product workflow the customer wants; do not advance the order."});
      answer.reply = clarification(products); answer.nextState=base;
      return answer;
    }
  }
  if (destination) {
    if (guidance.action === "order" || guidance.action === "support") intent = guidance.action;
    active = {...structuredClone(previous ?? freshState()),versionId:version.id,nodeId:destination,status:"running",awaiting:false};
    delete active.forceCollect;
    delete active.advisory;
    navigating = guidance.action === "order" || guidance.action === "support" || guidance.action === "route";
    revisiting = guidance.action === "revisit";
    const node = version.graph.nodes.find(n=>n.id===destination)!;
    const processEntry = version.graph.version === 2 && version.graph.flows.some(flow => flow.entryNodeId === destination);
    const explicitCorrection = /\b(ndrysho\w*|korrigjo\w*|ktheh\w*|change|correct|instead)\b/.test(params.message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
    const forceRecollection = revisiting || (guidance.action === "route" && (!processEntry || explicitCorrection));
    if (forceRecollection && node.kind === "collect") active.forceCollect=destination;
    if (revisiting || (forceRecollection && ["collect","confirm"].includes(node.kind))) {
      invalidateConfirmation(base);
      for (const n of version.graph.nodes.filter(n=>n.kind==="confirm")) delete active.values[n.id];
    }
    base.visual=active;
  }
  if(base.context && !active && base.product_id && intent==="order") base=resetOrder(base);
  let currentState=base;
  const extracted=base.context ? await extractMessageFacts(base,params.message,[...profileExtractionFields,...version.graph.nodes.filter(n=>n.kind==='collect').map(n=>({key:n.config.fieldKey!,type:n.config.fieldType||"text" as const,label:n.label}))]) : 0;
  const sharedValues = () => currentState.context ? Object.fromEntries(version.graph.nodes.filter(n=>n.config.fieldKey).flatMap(n=> {
    const fact=getFact(currentState,n.config.fieldKey!); return fact ? [[n.config.fieldKey!,fact.value]] : [];
  })) : currentState.visual?.values;
  const advance: typeof advanceVisualWorkflow = input => advanceVisualWorkflow({ ...input, sharedValues: sharedValues() });
  let execution = advance({ graph: version.graph, versionId: version.id, state: active,
    message: params.message, hasPhoto: params.hasPhoto, intent, ...((extracted || revisiting || guidance.action === "route" || params.bookingNavigation || (params.orderRequest && currentNode?.kind !== "product"))?{inputAvailable:false}:{}) });
  const traversed = [...execution.traversedNodeIds];
  const replies: string[] = [];
  let productCalled = false, bookingCalled = false, finished = false;
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
    if (action.kind === "booking") {
      if (bookingCalled) { replies.push("Për cilin shërbim dëshironi rezervimin?"); finished = true; break; }
      bookingCalled = true;
      const booking = await params.bookingTurn?.(turn.nextState);
      if (!booking) { replies.push("Për rezervimin, kontakto stafin e biznesit."); finished = true; break; }
      turn = booking; currentState = turn.nextState;
      replies.push(turn.reply);
      if (turn.nextState.fields.booking) { finished = true; break; }
      execution = advance({ graph: version.graph, versionId: version.id, state: execution.state,
        message: "", hasPhoto: false, intent, bookingComplete: true, inputAvailable: false });
      traversed.push(...execution.traversedNodeIds);
      continue;
    }
    if (action.kind === "product") {
      const continuing = !productCalled && Boolean((active?.nodeId === action.nodeId && active.awaiting) || (base.product_id && (revisiting || (navigating && base.step_key !== "order_ready"))));
      if (!continuing) {
        turn.nextState = { ...(turn.nextState.product_id ? (turn.nextState.context ? resetOrder(turn.nextState) : {...emptyState(),customer:turn.nextState.customer,recentMessages:turn.nextState.recentMessages}) : turn.nextState), visual: execution.state, completedVisual: base.completedVisual };
      }
      currentState=turn.nextState;
      // A loop back to a product starts a fresh selection on the NEXT incoming message.
      if (productCalled) { replies.push("Cilin produkt dëshironi?"); finished = true; break; }
      productCalled = true;
      turn = await legacy({ ...params, message: revisiting && base.product_id ? params.message : execution.inputConsumed && (!extracted || continuing) ? "" : params.message,
        hasPhoto: !execution.inputConsumed && params.hasPhoto, state: turn.nextState, previousResponseId: continuing ? params.previousResponseId : null,
        orderRequest: navigating && !revisiting, requireConfiguredWorkflow: true });
      currentState=turn.nextState;
      replies.push(turn.reply);
      if (turn.handoff) { execution.state.status = "handoff"; execution.state.advisory = turn.advisoryHandoff === true; execution.state.awaiting = false; finished = true; break; }
      if (turn.nextState.step_key !== "order_ready") { finished = true; break; }
      execution = advance({ graph: version.graph, versionId: version.id, state: execution.state,
        message: "", hasPhoto: false, intent, productComplete: true, inputAvailable: false });
      traversed.push(...execution.traversedNodeIds);
      continue;
    }
    if (action.kind === "prompt" && !revisiting && isQuestion(params.message) && !replies.length) {
      const answer = await legacy({ ...params, state: turn.nextState, informational: "Përgjigju pyetjes pa ndryshuar të dhënat e porosisë." });
      replies.push(answer.reply);
    }
    if(action.kind==="prompt") recordPrompt(turn.nextState,action.nodeId);
    if (action.message) replies.push(action.message);
    if (action.kind === "end" && !replies.length) replies.push("Faleminderit. Të dhënat u plotësuan.");
    if (action.kind === "handoff") { turn.handoff = true; turn.advisoryHandoff = true; execution.state.advisory = true; }
    finished = true;
    break;
  }
  if (!finished) throw new Error("workflow_execution_limit");
  turn.nextState.visual = execution.state;
  if (execution.state.status === "completed" || execution.state.status === "handoff") turn.nextState.completedVisual = structuredClone(execution.state);
  turn.reply = replies.join("\n\n");
  turn.visualWorkflow = { graph: version.graph, state: execution.state, traversedNodeIds: traversed, routing:{action:guidance.action,from:previous?.nodeId??null,to:destination??execution.state.nodeId,source:guidance.source} };
  turn.debug.elapsedMs = Date.now() - started;
  params.onTrace?.({ stage: "workflow", label: "Visual workflow executed", data: {
    workflowName: version.graph.name, versionId: version.id, intent, method: "Conversation guidance with validated workflow navigation",
    state: execution.state, traversedNodeIds: traversed, action: execution.action, preview: Boolean(params.visualPreview),
  } });
  return turn;
}
