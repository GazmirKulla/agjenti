import { executeWorkflowAction, renderActionMessage } from "@/lib/actions/workflow";
import { isStaffContactRequest, staffContactInstructions, staffHandoffReply } from "@/lib/conversations/handoff";
import { isIsolatedExecution, recordExternalAction } from "@/lib/runtime/execution-context";
import { chooseGuidance, clarification, invalidateConfirmation } from "../guidance";
import { decidedFieldGuidance, informationalDecision } from "@/lib/conversations/turn-decision";
import { extractMessageFacts, profileExtractionFields } from "../extract-facts";
import { getFact, setFact, resetOrder, isQuestion, recordPrompt, migrateContext, sharedPrompt, setOrderTerms } from "../context";
import { agentModel } from "@/lib/agents/generate";
import type { AgentTurnParams, AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { emptyState } from "../engine";
import { advanceVisualWorkflow, detectVisualIntent } from "./runtime";
import { loadVisualVersion } from "./store";
import { validateVisualGraph } from "./model";
import { isEntityInformationRequest, resolveVisualEntity } from "./entity-routing";
import { advanceVisualOrderReview, missingVisualOrderNode } from "./product-order";
import { capabilityModules, requireRuntimeModules } from "@/lib/capabilities/enforcement";
import { nodeCapabilityKeys, flowCapabilityKeys } from "@/lib/capabilities/graph";
import { ownedCollectNodes, pendingCollectNode } from "./facts";
import type { VisualFieldValidation } from "./types";
import { combineProductPresentations, type ReferenceProduct } from "@/lib/products/entity-bridge";

type Legacy = (params: AgentTurnParams & { informational?: string; requireConfiguredWorkflow?: boolean }) => Promise<AgentTurnResult>;

export async function executeVisualTurn(params: AgentTurnParams, legacyReply: Legacy): Promise<AgentTurnResult> {
  if (informationalDecision(params.turnDecision)) params = { ...params, informationRequest: true, orderRequest: false, bookingRequest: false };
  if (params.visualPreview && (params.mode !== "test" || params.visualPreview.businessId !== params.businessId)) throw new Error("invalid_workflow_preview");
  let previous = params.state?.visual;
  if (previous?.status === "completed" && params.entityVersion !== undefined && params.entityVersion?.id !== previous.versionId) previous = undefined;
  // Publishing the visual layer must not interrupt an existing linear product order.
  if (!params.visualPreview && !params.informationRequest && !params.supportRequest && !params.bookingRequest && !params.orderStatusRequest && !previous && params.state?.product_id && params.state.step_key !== "order_ready") return legacyReply({ ...params, trainingVisualScope: undefined });
  let active = previous && previous.status !== "completed" ? previous : null;
  const loadedVersion = params.visualPreview ?? (params.entityVersion !== undefined ? params.entityVersion : await loadVisualVersion(params.businessId, previous?.versionId));
  if (!loadedVersion) {
    if (active) throw new Error("missing_workflow_version");
    return legacyReply({ ...params, trainingVisualScope: undefined });
  }
  let version = loadedVersion;
  const presentations: { reply: string; presentedProducts?: ReferenceProduct[]; presentedServices?: ReferenceProduct[] }[] = [];
  const legacy = async (p: Parameters<Legacy>[0], executedNodeId?: string) => {
    const nodeId = executedNodeId ?? p.state?.visual?.nodeId;
    const flow = version.graph.version === 2 && p.state?.visual?.versionId === version.id
      ? version.graph.flows.find(f => f.nodeIds.includes(nodeId ?? "")) : undefined;
    const answer = await legacyReply({ ...p, trainingVisualScope: flow && nodeId ? { flowId: flow.id, nodeId } : undefined });
    presentations.push({ reply: answer.reply, presentedProducts: answer.presentedProducts, presentedServices: answer.presentedServices });
    return answer;
  };
  if (version.businessId !== params.businessId || !validateVisualGraph(version.graph).graph) throw new Error("invalid_visual_workflow");
  await requireRuntimeModules(params.businessId, ["workflows"]);
  const guardNodes = async (ids: string[]) => {
    const flows = version.graph.version === 2 ? version.graph.flows.filter(flow => flow.nodeIds.some(id => ids.includes(id))) : [];
    await requireRuntimeModules(params.businessId, ["workflows", ...capabilityModules([
      ...version.graph.nodes.filter(node => ids.includes(node.id)).flatMap(nodeCapabilityKeys), ...flows.flatMap(flowCapabilityKeys),
    ]), ...(flows.some(flow => flow.serviceIds?.length) ? ["services"] : [])]);
  };
  const started = Date.now();
  // Completion does not erase order/customer data. Only entering a new product flow resets it.
  let base = structuredClone(params.state ?? emptyState());
  if (!previous) delete base.visual;
  const simple = (reply: string): AgentTurnResult => ({ reply, nextState: base, previousResponseId: null, workflowId: null, productName: null, workflowProgress: [],
    debug: { model: agentModel(), source: "fallback", fallbackReason: "visual_entity", agentConfigured: true, knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: Date.now() - started } });
  const explicitOrder = params.orderRequest || (params.turnDecision ? params.turnDecision.intent === "order" : detectVisualIntent(params.message) === "order");
  const informationalEntity = params.turnDecision ? informationalDecision(params.turnDecision)
    : !explicitOrder && !params.bookingRequest && (isQuestion(params.message) || isEntityInformationRequest(params.message));
  const decidedEntity = params.turnDecision?.entity;
  const entityResolution = !params.informationRequest && !params.orderStatusRequest && !informationalEntity ? await resolveVisualEntity(params.businessId, version.graph, params.message, previous?.binding, params.mode === "test", { state: base,
    selectedProductId: params.selectedProductId ?? (decidedEntity?.status === "resolved" && decidedEntity.kind === "product" ? decidedEntity.id : undefined),
    selectedServiceId: params.selectedServiceId ?? (decidedEntity?.status === "resolved" && decidedEntity.kind === "service" ? decidedEntity.id : undefined),
    deliveredReply: params.deliveredReply, draftPreview: Boolean(params.visualPreview) }) : {};
  const selectedEntity = entityResolution.selected;
  if (entityResolution.clarification) return { ...simple(entityResolution.clarification),
    ...(params.turnDecision ? { turnDecision: { ...params.turnDecision, kind: "clarification" as const, reason: "entity" as const } } : {}) };
  if (entityResolution.choices?.length) return { ...simple(`Cilin produkt ose shërbim dëshironi: ${entityResolution.choices.map(entity => entity.name).join(", ")}?`),
    presentedProducts: entityResolution.choices.every(entity => entity.kind === "product") ? entityResolution.choices : undefined,
    presentedServices: entityResolution.choices.every(entity => entity.kind === "service") ? entityResolution.choices : undefined };
  if (!selectedEntity && entityResolution.mentioned?.kind === "product" && previous?.binding && entityResolution.mentioned.id !== previous.binding.entity.id) {
    if (base.product_id && base.step_key !== "order_ready") {
      if (base.processes) base.processes.pendingChoice = { kind: "replace", process: "order", message: params.message, productId: entityResolution.mentioned.id };
      return simple(`Ke një porosi të papërfunduar. Ta zëvendësojmë me ${entityResolution.mentioned.name}? Shkruaj “Po” ose “Jo”.`);
    }
    previous = undefined; active = null; delete base.visual;
  }
  if (previous?.binding && !params.informationRequest && !params.orderStatusRequest && !informationalEntity && !selectedEntity) return { ...simple("Produkti ose shërbimi i këtij procesi nuk është më aktiv. Kontakto stafin për të vazhduar."),
    ...(params.turnDecision ? { turnDecision: { ...params.turnDecision, kind: "blocked" as const, reason: "capability" as const } } : {}) };
  const generalOrderFlows = () => version.graph.version === 2 ? version.graph.flows.filter(flow => flow.kind === "order" && !flow.productIds?.length && !flow.serviceIds?.length) : [];
  if (!selectedEntity && entityResolution.mentioned?.kind === "product" && !generalOrderFlows().length) {
    if (params.visualPreview) {
      params.onTrace?.({ stage: "workflow", label: "Draft preview blocked", status: "skipped", data: {
        businessId: params.businessId, executionMode: "isolated", workflowSource: "draft", versionId: version.id,
        reasonCode: "preview_binding_missing", validation: "not_executed", entityId: entityResolution.mentioned.id,
      } });
      const result = simple("Produkti nuk ka lidhje me këtë draft. Konfiguro lidhjen në rrjedhë dhe rifillo provën; nuk u ekzekutua një workflow tjetër.");
      result.debug.fallbackReason = "preview_binding_missing";
      return result;
    }
    return legacy({ ...params, state: base, requireConfiguredWorkflow: true });
  }
  const boundFlow = selectedEntity && version.graph.version === 2 ? version.graph.flows.find(flow => flow.id === selectedEntity.binding.flowId) : undefined;
  const boundOrder = selectedEntity?.entity.kind === "product" && Boolean(boundFlow && (boundFlow.kind === "order" || boundFlow.nodeIds.some(id => version.graph.nodes.some(node => node.id === id && node.kind === "product")) || boundFlow.kind === "custom" && (params.orderRequest || base.product_id === selectedEntity.entity.id && previous?.binding?.entity.id === selectedEntity.entity.id)));
  if (!generalOrderFlows().length && !selectedEntity && !base.product_id && !entityResolution.mentioned && (params.orderRequest || detectVisualIntent(params.message) === "order") && entityResolution.available?.some(entity => entity.kind === "product")) return {
    ...simple(`Cilin produkt dëshironi? ${entityResolution.available.filter(entity => entity.kind === "product").map(entity => entity.name).join(", ")}.`),
    presentedProducts: entityResolution.available.filter(entity => entity.kind === "product"),
  };
  const enteringEntity = Boolean(boundFlow && (!previous?.binding || previous.binding.entity.id !== selectedEntity!.entity.id || previous.status === "completed"));
  if (enteringEntity && selectedEntity?.entity.kind === "product" && base.product_id && base.product_id !== selectedEntity.entity.id && base.step_key !== "order_ready") {
    if (base.processes) base.processes.pendingChoice = { kind: "replace", process: "order", message: params.message, productId: selectedEntity.entity.id };
    return simple(`Ke një porosi të papërfunduar. Ta zëvendësojmë me ${selectedEntity.entity.name}? Shkruaj “Po” ose “Jo”.`);
  }
  if (selectedEntity && boundFlow) {
    await guardNodes([boundFlow.entryNodeId]);
    base = migrateContext(base);
    base.context!.execution.factOwner = boundOrder ? "order" : params.bookingRequest ? "booking" : "service";
    if (boundOrder) {
      base.product_id = selectedEntity.entity.id; base.product_type_id = selectedEntity.entity.productTypeId ?? null;
      setOrderTerms(base, selectedEntity.entity);
      delete base.context!.execution.linear; delete base.linearSnapshot; delete base.orderWorkflowSnapshot;
    }
    if (enteringEntity) active = { versionId: version.id, nodeId: boundFlow.entryNodeId, status: "running", awaiting: false, visited: [], values: {}, binding: selectedEntity.binding };
    else if (active) active = { ...active, binding: selectedEntity.binding };
    base.visual = active ?? base.visual;
  }
  if (isStaffContactRequest(params.message) && !explicitOrder && !params.bookingRequest && !params.informationRequest) {
    const answer = await legacy({ ...params, state: base, informational: staffContactInstructions });
    answer.nextState = base;
    answer.handoff = true; answer.advisoryHandoff = true;
    return answer;
  }
  let intent = params.bookingRequest ? "booking" as const : params.turnDecision
    ? params.turnDecision.intent === "information" ? "question" as const : params.turnDecision.intent === "undetermined" ? "unknown" as const : params.turnDecision.intent
    : detectVisualIntent(params.message);
  let navigating = false;
  let revisiting = false;
  const currentNode = version.graph.nodes.find(n => n.id === previous?.nodeId);
  const routesFor = (graph: typeof version.graph) => {
    const flows = graph.version === 2 ? graph.flows : [];
    return graph.nodes.flatMap(n => {
      const flow = flows.find(flow => flow.entryNodeId === n.id);
      const owningFlow = flows.find(flow => flow.nodeIds.includes(n.id));
      if (owningFlow && (owningFlow.productIds?.length || owningFlow.serviceIds?.length) && owningFlow.id !== boundFlow?.id) return [];
      const statusFlow = flow?.nodeIds.some(id => graph.nodes.some(node => node.id === id && node.kind === "order_status"));
      const processKind = statusFlow ? "order_status" : flow?.kind === "order" ? "product" : flow?.kind === "booking" ? "booking" : flow?.kind === "support" ? "support_entry" : flow?.kind === "information" ? "knowledge" : undefined;
      if (processKind) return [{ id: statusFlow ? graph.nodes.find(node => node.kind === "order_status" && flow!.nodeIds.includes(node.id))!.id : n.id, label: flow!.label, prompt: n.config.prompt, fieldKey: n.config.fieldKey, kind: processKind }];
      // Process nodes are entered through their configured flow entry; inner collection
      // steps remain selectable for corrections after that task has begun.
      if (["product", "booking", "order_status", "handoff", "knowledge"].includes(n.kind) && flows.some(flow => flow.nodeIds.includes(n.id))) return [];
      return ["collect", "confirm", "knowledge", "product", "booking", "order_status", "handoff"].includes(n.kind)
        ? [{ id: n.id, label: n.label, prompt: n.config.prompt, fieldKey: n.config.fieldKey, kind: n.kind as string }]
        : n.kind === "condition" && n.config.condition === "intent_support" && !flows.some(flow => flow.kind === "support")
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
  const statusEntries = routes.filter(node => node.kind === "order_status");
  const statusFlow = version.graph.version === 2 ? version.graph.flows.find(flow => flow.nodeIds.includes(previous?.nodeId ?? "") && flow.nodeIds.some(id => version.graph.nodes.some(node => node.id === id && node.kind === "order_status"))) : undefined;
  const continuingStatus = params.orderStatusRequest && previous?.status === "waiting" && Boolean(statusFlow || currentNode?.kind === "order_status");
  const informationFlow = version.graph.version === 2 ? version.graph.flows.find(flow => flow.kind === "information" && flow.nodeIds.includes(previous?.nodeId ?? "")) : undefined;
  const continuingInformation = params.informationRequest && !params.orderStatusRequest && previous?.status === "waiting" && Boolean(informationFlow) && !statusFlow;
  const correctionRequest = /\b(ndrysho\w*|korrigjo\w*|ktheh\w*|pas|mbrapa|change|correct|instead|back)\b/.test(params.message.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
  // A correction may select a field within the decided process, not a new
  // order/booking flow. Legacy callers without a decision retain their routing.
  const correctingFlow = params.turnDecision?.kind === "correction" && version.graph.version === 2
    ? version.graph.flows.find(flow => previous?.binding ? flow.id === previous.binding.flowId : flow.nodeIds.includes(previous?.nodeId ?? "")) : undefined;
  const correctionRoutes = correctingFlow ? routes.filter(route => correctingFlow.nodeIds.includes(route.id)) : routes;
  const guidance = params.actionFlowRequest && !correctionRequest ? {action:"continue" as const,target:null,source:"rules" as const} : enteringEntity ? { action: "route" as const, target: boundFlow!.entryNodeId, source: "rules" as const }
    : params.informationRequest && !params.orderStatusRequest && !informationEntries.length ? { action: "answer" as const, target: null, source: "rules" as const }
    : continuingStatus ? { action: "continue" as const, target: null, source: "rules" as const }
    : params.orderStatusRequest && statusEntries.length ? { action: "route" as const, target: statusEntries[0].id, source: "rules" as const }
    : !correctionRequest && (continuingBooking || continuingOrder || continuingInformation) ? { action: "continue" as const, target: null, source: "rules" as const }
    : params.informationRequest && informationEntries.length === 1 ? { action: "route" as const, target: informationEntries[0].id, source: "rules" as const }
    : params.bookingRequest && bookingNodes.length === 1 ? { action: "route" as const, target: bookingNodes[0].id, source: "rules" as const } : decidedFieldGuidance(params.turnDecision, routes) ?? await chooseGuidance({message:params.message,state:base,targets: targets.filter(target => correctionRoutes.some(route => route.id === target.id)),routes: correctionRoutes,
    current:currentNode ? {id:currentNode.id,label:currentNode.label,prompt:currentNode.config.prompt,fieldKey:currentNode.config.fieldKey,kind:currentNode.kind} : undefined,
    allowOrder:params.turnDecision?.kind !== "correction" && routes.some(n=>n.kind==="product"), allowSupport:params.turnDecision?.kind !== "correction" && routes.some(n=>n.kind==="handoff" || n.kind==="support_entry"),
  });
  params.onTrace?.({stage:"workflow",label:"New message routed",data:{...guidance,from:previous?.nodeId??null,candidates:routes.map(r=>r.id)}});
  let extractedValues: Record<string, string> = {};
  const extractFacts = async () => {
    if (params.selectedProductId) return 0; // A selection is navigation, not a collected field value.
    const fields = ownedCollectNodes(version.graph, base.visual).map(n => ({ key: n.config.fieldKey!, type: n.config.fieldType || "text" as const, label: n.config.prompt || n.label }));
    if (!fields.length && !base.context) return 0;
    // Older visual conversations store fields on the cursor. Do not enable the
    // shared order engine merely to remember a fact for their visual workflow.
    const target = base.context ? base : migrateContext();
    const count = await extractMessageFacts(target, params.message, [...(base.context ? profileExtractionFields : []), ...fields], { questionFacts: true });
    if (!base.context) extractedValues = Object.fromEntries(fields.flatMap(field => {
      const fact = getFact(target, field.key); return fact ? [[field.key, fact.value]] : [];
    }));
    return count;
  };
  const freshState = () => ({versionId:version.id,nodeId:version.graph.nodes.find(n=>n.kind==="start")!.id,status:"running" as const,awaiting:false,visited:[],values:{}});
  if (guidance.action === "clarify" || (guidance.action === "answer" && (previous || !informationEntries.length))) {
    if (guidance.action === "answer") await extractFacts();
    const answer = await legacy({...params,state:base,informational:"Answer the current question without advancing or repeating workflow questions."});
    answer.nextState = base;
    answer.workflowId = params.persistedWorkflowId ?? base.context?.execution.linear?.id ?? base.linearSnapshot?.id ?? answer.workflowId;
    if (guidance.action === "clarify") answer.reply = clarification(routes);
    const visual = { ...(previous ?? freshState()), values: { ...previous?.values, ...extractedValues } };
    answer.nextState.visual = visual;
    answer.visualWorkflow = {graph:version.graph,state:visual,traversedNodeIds:[],routing:{action:guidance.action,from:previous?.nodeId??null,to:visual.nodeId,source:guidance.source}};
    return answer;
  }
  let destination = guidance.target;
  if (guidance.action === "answer" && !previous) destination = routes.find(n=>n.kind==="knowledge")?.id ?? null;
  if (guidance.action === "order" && previous?.status === "completed" && !params.visualPreview) {
    const latest = await loadVisualVersion(params.businessId);
    if (!latest) return legacyReply({ ...params, trainingVisualScope: undefined });
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
    active = {...structuredClone(active ?? previous ?? freshState()),versionId:version.id,nodeId:destination,status:"running",awaiting:false};
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
  const extracted = await extractFacts();
  const sharedValues = () => currentState.context ? Object.fromEntries(version.graph.nodes.filter(n=>n.config.fieldKey).flatMap(n=> {
    const fact=getFact(currentState,n.config.fieldKey!); return fact ? [[n.config.fieldKey!,fact.value]] : [];
  })) : { ...currentState.visual?.values, ...extractedValues };
  const fieldValidation: VisualFieldValidation[] = [];
  const advance: typeof advanceVisualWorkflow = input => {
    const result = advanceVisualWorkflow({ ...input, sharedValues: sharedValues() });
    fieldValidation.push(...result.fieldValidation ?? []);
    return result;
  };
  const reviewingOrder = boundOrder && Boolean(previous?.binding) && currentNode?.kind === "end" && previous?.awaiting && (!destination || destination === previous.nodeId);
  if (reviewingOrder) {
    const review = advanceVisualOrderReview(base, params.orderRequest ? "" : params.message, params.hasPhoto, false, version.graph, selectedEntity!.entity.name);
    base = review.nextState;
    base.visual = { ...previous!, status: review.complete ? "completed" : "waiting", awaiting: !review.complete };
    const result = simple(review.reply); result.nextState = base; result.productName = selectedEntity!.entity.name;
    result.visualWorkflow = { graph: version.graph, state: base.visual, traversedNodeIds: [], routing: { action: "continue", from: previous!.nodeId, to: previous!.nodeId, source: "rules" } };
    return result;
  }
  // Collection/final order review can repair a value. A pending approval cannot
  // consume yes while an earlier invalid correction remains unresolved.
  if (base.context?.execution.invalidFields?.length && currentNode?.kind !== "collect") {
    invalidateConfirmation(base);
    if (base.visual) { delete base.visual.pendingConfirmation; delete base.visual.confirmedConfirmation; }
    return simple(sharedPrompt(base, []));
  }
  let execution = advance({ graph: version.graph, versionId: version.id, state: active,
    message: params.message, hasPhoto: params.hasPhoto, intent, ...((extracted || revisiting || guidance.action === "route" || params.bookingNavigation || (params.orderRequest && currentNode?.kind !== "product"))?{inputAvailable:false}:{}) });
  const traversed = [...execution.traversedNodeIds];
  const replies: string[] = [];
  let productCalled = false, bookingCalled = false, orderStatusCalled = false, finished = false;
  let turn: AgentTurnResult = {
    reply: "", nextState: base, previousResponseId: null, workflowId: null, productName: null, workflowProgress: [],
    debug: { model: agentModel(), source: "fallback", fallbackReason: "workflow_prompt", agentConfigured: false,
      knowledgeCount: 0, productCount: 0, workflowSteps: [], elapsedMs: 0 },
  };
  for (let count = 0; count < 32; count++) {
    // The pure runtime only changes a cloned cursor. Authorize the actual path
    // before persisting its fields or calling any read/write adapter.
    await guardNodes([...execution.traversedNodeIds, execution.state.nodeId]);
    const action = execution.action;
    // An information reply cannot implicitly start/resume an order or booking
    // merely because a configured edge crosses into that process.
    if (params.informationRequest && (action.kind === "product" || action.kind === "booking")) {
      if (!replies.length) {
        turn = await legacy({ ...params, state: turn.nextState, informational: "Answer only the current informational request using verified business knowledge. Do not ask the previous order/booking question or advance either process." });
        replies.push(turn.reply);
      }
      execution.state.status = "completed"; execution.state.awaiting = false;
      turn.nextState.visual = execution.state; currentState = turn.nextState;
      finished = true; break;
    }
    turn.nextState.visual = execution.state;
    if(turn.nextState.context) for(const node of version.graph.nodes.filter(node => node.kind === "collect" && execution.traversedNodeIds.includes(node.id))) {
      const value=execution.state.values[node.config.fieldKey!];
      if(value) setFact(turn.nextState,node.config.fieldKey!,value,node.config.fieldType||"text",`visual:${node.id}`);
    }
    if (action.kind === "action") {
      const node=version.graph.nodes.find(n=>n.id===action.nodeId)!;
      let outcome:"yes"|"no"="yes";
      try {
        if(params.informationRequest) throw new Error("Veprimi kërkon vazhdimin e procesit.");
        if(!node.config.action)throw new Error("Veprimi nuk është konfiguruar.");
        const output=await executeWorkflowAction({businessId:params.businessId,versionId:version.id,nodeId:node.id,binding:node.config.action,values:execution.state.values,mode:isIsolatedExecution()?"test":params.mode,guard:params.actionGuard});
        execution.state.actionResults={...execution.state.actionResults,[node.id]:output};
      } catch {
        outcome="no";
        execution.state.actionResults={...execution.state.actionResults,[node.id]:{error:"Veprimi nuk u konfirmua. Kontrollo të dhënat, lejet ose kërko ndihmën e stafit."}};
      }
      execution=advance({graph:version.graph,versionId:version.id,state:execution.state,message:"",hasPhoto:false,intent,inputAvailable:false,actionOutcome:outcome});
      traversed.push(...execution.traversedNodeIds);
      continue;
    }
    if (action.message) action.message=renderActionMessage(action.message,execution.state.actionResults);
    if (action.kind === "knowledge") {
      turn = await legacy({ ...params, state: turn.nextState, informational: action.message ?? "" }, action.nodeId);
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
      if (!booking) {
        if (isIsolatedExecution() && !params.bookingTurn) {
          recordExternalAction({ kind: "booking.create", disposition: "BLOCKED", detail: "missing_test_adapter" });
          replies.push("Provë: rezervimi nuk u ekzekutua sepse mungon adapteri i izoluar. Nuk u krijua rezervim real.");
        } else replies.push("Për rezervimin, kontakto stafin e biznesit.");
        finished = true; break;
      }
      turn = booking; currentState = turn.nextState;
      replies.push(turn.reply);
      if (turn.nextState.fields.booking) { finished = true; break; }
      execution = advance({ graph: version.graph, versionId: version.id, state: execution.state,
        message: "", hasPhoto: false, intent, bookingComplete: true, inputAvailable: false });
      traversed.push(...execution.traversedNodeIds);
      continue;
    }
    if (action.kind === "order_status") {
      // A status lookup is read-only and may wait for the customer's choice.
      // Never run it twice in a turn, even if the graph points back to it.
      if (orderStatusCalled) { finished = true; break; }
      orderStatusCalled = true;
      if (!params.orderStatusRequest) {
        const answer = await legacy({ ...params, state: turn.nextState, informational: "Answer only the current informational request. Do not claim to have looked up an existing order." });
        replies.push(answer.reply); execution.state.status = "completed"; execution.state.awaiting = false; finished = true; break;
      }
      const status = await params.orderStatusTurn?.(turn.nextState);
      if (!status) { replies.push("Për të kontrolluar statusin e porosisë, kontakto stafin."); finished = true; break; }
      turn = status; currentState = turn.nextState; replies.push(turn.reply);
      if (turn.orderStatusPending) { finished = true; break; }
      // A status answer completes this message. Downstream prompts would lose
      // their cursor when the coordinator restores the interrupted task.
      execution.state.status = "completed"; execution.state.awaiting = false;
      finished = true; break;
    }
    if (action.kind === "product") {
      if (selectedEntity) {
        if (productCalled) { replies.push("Vazhdojmë procesin me mesazhin tjetër."); finished = true; break; }
        productCalled = true;
        turn.productName = selectedEntity.entity.kind === "product" ? selectedEntity.entity.name : null;
        execution.state.awaiting = true;
        execution = advance({ graph: version.graph, versionId: version.id, state: execution.state, message: "", hasPhoto: false, intent, productComplete: true, inputAvailable: false });
        traversed.push(...execution.traversedNodeIds); continue;
      }
      const continuing = !productCalled && Boolean((active?.nodeId === action.nodeId && active.awaiting) || (base.product_id && (revisiting || (navigating && base.step_key !== "order_ready"))));
      if (!continuing) {
        turn.nextState = { ...(turn.nextState.product_id ? (turn.nextState.context ? resetOrder(turn.nextState) : {...emptyState(),customer:turn.nextState.customer,recentMessages:turn.nextState.recentMessages}) : turn.nextState), visual: execution.state, completedVisual: base.completedVisual };
      }
      currentState=turn.nextState;
      // A loop back to a product starts a fresh selection on the NEXT incoming message.
      if (productCalled) { replies.push("Cilin produkt dëshironi?"); finished = true; break; }
      productCalled = true;
      const startingGeneralOrder = !continuing && generalOrderFlows().some(flow => flow.entryNodeId === action.nodeId) && (params.orderRequest || guidance.action === "order");
      // Keep the coordinator's resume intent: a command is not an answer to
      // the pending product field, even when the visual cursor already waits here.
      turn = await legacy({ ...params, message: startingGeneralOrder || revisiting && base.product_id ? params.message : execution.inputConsumed && (!extracted || continuing) ? "" : params.message,
        hasPhoto: !execution.inputConsumed && params.hasPhoto, state: turn.nextState, previousResponseId: continuing ? params.previousResponseId : null,
        orderRequest: params.orderRequest || (navigating && !revisiting), requireConfiguredWorkflow: !generalOrderFlows().some(flow => flow.nodeIds.includes(action.nodeId)) });
      currentState=turn.nextState;
      replies.push(turn.reply);
      if (turn.handoff) { execution.state.status = "handoff"; execution.state.advisory = turn.advisoryHandoff === true; execution.state.awaiting = false; finished = true; break; }
      if (turn.nextState.step_key !== "order_ready") { finished = true; break; }
      execution = advance({ graph: version.graph, versionId: version.id, state: execution.state,
        message: "", hasPhoto: false, intent, productComplete: true, inputAvailable: false });
      traversed.push(...execution.traversedNodeIds);
      continue;
    }
    if (action.kind === "end" && selectedEntity && boundOrder) {
      const missing = missingVisualOrderNode(version.graph, execution.state, turn.nextState);
      if (missing) {
        execution = advance({ graph: version.graph, versionId: version.id, state: { ...execution.state, nodeId: missing, awaiting: false, status: "running" }, message: "", hasPhoto: false, intent, inputAvailable: false });
        traversed.push(...execution.traversedNodeIds); continue;
      }
      const review = advanceVisualOrderReview(turn.nextState, "", false, true, version.graph, selectedEntity.entity.name);
      turn.nextState = review.nextState; currentState = turn.nextState; turn.workflowId = null; turn.productName = selectedEntity.entity.name;
      execution.state.status = review.complete ? "completed" : "waiting"; execution.state.awaiting = !review.complete;
      replies.push(review.reply); finished = true; break;
    }
    const informationalInterruption = action.kind === "prompt" && !revisiting && !correctionRequest
      && (isQuestion(params.message) || params.informationRequest)
      && (replies.length > 0 || previous?.nodeId === action.nodeId && previous.awaiting);
    if (action.kind === "prompt" && !revisiting && isQuestion(params.message) && !replies.length) {
      const answer = await legacy({ ...params, state: turn.nextState, informational: "Përgjigju pyetjes pa ndryshuar të dhënat e porosisë." });
      replies.push(answer.reply);
      turn.presentedProducts = answer.presentedProducts;
      turn.presentedServices = answer.presentedServices;
    }
    // Keep required collection pending, but never append it to an unrelated answer.
    if (informationalInterruption) { finished = true; break; }
    if(action.kind==="prompt") recordPrompt(turn.nextState,action.nodeId);
    if (action.message && action.kind !== "handoff") replies.push(action.message);
    if (action.kind === "end" && !replies.length) replies.push("Faleminderit. Të dhënat u plotësuan.");
    if (action.kind === "handoff") {
      turn.handoff = true; turn.advisoryHandoff = false; execution.state.advisory = false;
      if (isIsolatedExecution() || params.mode === "test") {
        recordExternalAction({ kind: "staff.handoff", disposition: "SIMULATED", detail: "test_state_only" });
      }
      replies.push(staffHandoffReply(params.mode === "test" || isIsolatedExecution()));
    }
    finished = true;
    break;
  }
  if (!finished) throw new Error("workflow_execution_limit");
  turn.nextState.visual = execution.state;
  if (execution.state.status === "completed" || execution.state.status === "handoff") turn.nextState.completedVisual = structuredClone(execution.state);
  turn.reply = replies.join("\n\n");
  turn.visualWorkflow = { graph: version.graph, state: execution.state, traversedNodeIds: traversed, routing:{action:guidance.action,from:previous?.nodeId??null,to:destination??execution.state.nodeId,source:guidance.source} };
  turn.debug.elapsedMs = Date.now() - started;
  const pendingField = pendingCollectNode(version.graph, execution.state);
  params.onTrace?.({ stage: "workflow", label: "Visual workflow executed", data: {
    workflowName: version.graph.name, versionId: version.id, intent, method: "Conversation guidance with validated workflow navigation",
    businessId: params.businessId, executionMode: params.mode === "test" || isIsolatedExecution() ? "isolated" : "live",
    workflowSource: params.visualPreview ? "draft" : previous?.versionId === version.id ? "pinned" : "published",
    fromNodeId: previous?.nodeId ?? null, currentNodeId: execution.state.nodeId,
    fieldKey: pendingField?.config.fieldKey ?? null, fieldType: pendingField?.config.fieldType ?? (pendingField ? "text" : null),
    binding: execution.state.binding ?? null, fieldValidation, traversedNodeIds: traversed,
    action: { kind: execution.action.kind, nodeId: execution.action.nodeId }, preview: Boolean(params.visualPreview),
  } });
  turn.presentedProducts = combineProductPresentations(turn.reply, presentations);
  turn.presentedServices = combineProductPresentations(turn.reply, presentations.map(part => ({ reply: part.reply, presentedProducts: part.presentedServices })));
  return turn;
}
