import { rememberTurn, chooseGuidance, clarification, invalidateConfirmation } from "@/lib/workflows/guidance";
import { readOrderSnapshot, sealOrderSnapshot } from "@/lib/workflows/order-snapshot";
import { extractMessageFacts, profileExtractionFields } from "@/lib/workflows/extract-facts";
import { detectVisualIntent } from "@/lib/workflows/visual/runtime";
import { sharedWorkflowEnabled, migrateContext, extractExplicitFacts, advanceSharedOrder, sharedPrompt, isQuestion, resetOrder, recordPrompt } from "@/lib/workflows/context";
import type { TraceObserver } from "./trace";
import { loadBusinessProcess } from "@/lib/discovery/load-process";
import { businessProcessContext } from "@/lib/discovery/business-process";
import { loadActiveTrainingMemories } from "@/lib/agents/training/load";
import { selectTrainingContext } from "@/lib/agents/training/model";
import { retrieveBusinessSources } from "@/lib/catalogs/retrieval";
import { rankKnowledge } from "@/lib/catalogs/source-ranking";
import { routeIntent } from "@/lib/catalogs/ranking";
import { agentModel, generateAgentReply } from "@/lib/agents/generate";
import { shortenDescription } from "@/lib/products/parse";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  applyInboundToState,
  buildWorkflowProgress,
  emptyState,
  foldText,
  type ConversationStatePayload,
  type WorkflowProgressItem,
  type WorkflowStepDef,
  type WorkflowStepKind,
} from "@/lib/workflows/engine";

export type AgentTurnResult = {
  visualWorkflow?: import("@/lib/workflows/visual/types").VisualTrace;
  handoff?: boolean;
  advisoryHandoff?: boolean;
  reply: string;
  nextState: ConversationStatePayload;
  previousResponseId: string | null;
  workflowId: string | null;
  productName: string | null;
  workflowProgress: WorkflowProgressItem[];
  debug: {
    model: string;
    source: "ai" | "fallback";
    fallbackReason: string | null;
    agentConfigured: boolean;
    knowledgeCount: number;
    productCount: number;
    workflowSteps: string[];
    elapsedMs: number;
    retrievedCatalogIds?: string[];
    retrievedService?: boolean;
    trainingMemoryIds?: string[];
  };
};

function matchesSku(sku: string | null | undefined, message: string) {
  if (!sku?.trim()) return false;
  const key = foldText(sku).trim(),
    query = foldText(message).trim();
  if (query === key) return true;
  if (key.length < 2) return query === `sku ${key}`;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(query);
}

function pickProduct<T extends { id: string; name: string }>(
  products: T[],
  message: string,
): T | null {
  const normalized = foldText(message);
  if (!normalized) return null;
  const exact = products.filter((p) => foldText(p.name) === normalized);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const scored = products
    .map((p) => {
      const name = foldText(p.name);
      if (!name || name.length < 2) return { p, score: 0 };
      if (normalized.includes(name)) return { p, score: name.length + 100 };
      if (name.includes(normalized) && normalized.length >= 3)
        return { p, score: normalized.length };
      // Token overlap: "dua bluze te zeze" vs "Bluzë"
      const tokens = normalized
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3);
      const hit = tokens.some((t) => name.includes(t) || t.includes(name));
      return { p, score: hit ? name.length : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].p;
}

/** Shared business reply pipeline. Reads business context and calls AI only.
 * No inbox writes, order creation, Instagram connection lookup or Meta sends.
 * Caller is responsible for authorization and, for real turns, persistence/send.
 */
export type AgentTurnParams = {
  /** Trusted conversation_states.workflow_id, supplied only by the inbound server. */
  persistedWorkflowId?: string | null;
  linearPreview?: boolean;
  /** A routed order request is not an answer to the pending product field. */
  orderRequest?: boolean;
  visualPreview?: import("@/lib/workflows/visual/types").VisualVersion;
  onTrace?: TraceObserver;
  mode?: "production" | "test";
  source?: "instagram" | "admin_chat_lab";
  businessId: string;
  message: string;
  hasPhoto: boolean;
  state?: ConversationStatePayload | null;
  previousResponseId?: string | null;
};
export async function processAgentTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const turn = await processTurn(params);
  rememberTurn(params.state, turn.nextState, params.message, turn.reply);
  return turn;
}
async function processTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  if (sharedWorkflowEnabled(params.businessId) || params.state?.schemaVersion === 2) {
    params = { ...params, state: migrateContext(params.state) };
    extractExplicitFacts(params.state!, params.message);
  }
  if(params.linearPreview) {
    if(params.mode!=="test"||!params.state?.context?.execution.linear?.versionId.startsWith("linear-preview:")) throw new Error("invalid_linear_preview");
    return processLegacyAgentTurn(params);
  }
  // Client-supplied graph previews enter only through authenticated test actions.
  if (params.visualPreview && (params.mode !== "test" || params.visualPreview.businessId !== params.businessId)) throw new Error("invalid_workflow_preview");
  const { executeVisualTurn } = await import("@/lib/workflows/visual/execute");
  return executeVisualTurn(params, processLegacyAgentTurn);
}
async function processLegacyAgentTurn(params: AgentTurnParams & { informational?: string; requireConfiguredWorkflow?: boolean }): Promise<AgentTurnResult> {
  const db = createServiceSupabase();
  const started = Date.now();
  const trace = params.onTrace;
  trace?.({ stage: "overview", label: "Message received", data: { input: params.message, mode: params.mode ?? "production", source: params.source ?? "instagram" } });
  const [productResult, agentResult, knowledgeResult, trainingMemories, operating] = await Promise.all([
    db
      .from("products")
      .select(
        "id,name,sku,description,product_type_id,workflow_id,price_amount,currency",
      )
      .eq("business_id", params.businessId)
      .eq("is_active", true),
    db
      .from("ai_agents")
      .select("instructions")
      .eq("business_id", params.businessId)
      .eq("is_active", true)
      .maybeSingle(),
    db
      .from("knowledge_entries")
      .select("title,body,intent_key")
      .eq("business_id", params.businessId)
      .eq("is_active", true)
      .order("sort_order")
      .limit(1000),
    loadActiveTrainingMemories(params.businessId),
    loadBusinessProcess(params.businessId),
  ]);
  const businessProcess = businessProcessContext(operating.process);
  if (businessProcess) trace?.({ stage: "workflow", label: "Business customer journey loaded", data: { process: operating.process, revision: operating.revision, informational: true } });
  if (productResult.error || agentResult.error || knowledgeResult.error) {
    trace?.({ stage: "context", label: "Business context failed to load", status: "error", data: {
      products: productResult.error ? "failed" : "loaded",
      instructions: agentResult.error ? "failed" : "loaded",
      knowledge: knowledgeResult.error ? "failed" : "loaded",
    } });
    throw new Error("Nuk u ngarkua konfigurimi i agjentit.");
  }
  trace?.({ stage: "tools", label: "loadBusinessContext", status: "success", data: {
    input: { businessId: params.businessId, activeOnly: true },
    output: { products: productResult.data?.length ?? 0, knowledge: knowledgeResult.data?.length ?? 0, agent: Boolean(agentResult.data) },
    durationMs: Date.now() - started, readOnly: true,
  } });
  const products = productResult.data ?? [];
  const agent = agentResult.data;
  function trainingFor(workflowId: string | null, stepKey: string | null | undefined) {
    const context = selectTrainingContext(trainingMemories, workflowId, stepKey, params.message);
    if (context.rules.length) trace?.({ stage: "context", label: "Business training selected", data: { workflowId, stepKey, rules: context.rules } });
    return context;
  }
  const rankedKnowledge = rankKnowledge(
    knowledgeResult.data ?? [],
    params.message,
  );
  const knowledge = rankedKnowledge.slice(0, 12).map((k) => k.entry);
  trace?.({ stage: "context", label: "Business context loaded", data: {
    businessId: params.businessId, instructions: agent?.instructions ?? null,
    products, knowledge, previousState: params.state ?? emptyState(),
    previousResponseId: params.previousResponseId ?? null,
    history: params.state?.recentMessages ?? [],
  } });
  let state = structuredClone(params.state ?? emptyState());
  const text = params.message.trim();
  if(state.context && state.step_key==="order_ready" && detectVisualIntent(text)==="order" && params.informational===undefined) state=resetOrder(state);
  if (state.product_id && !products.some((p) => p.id === state.product_id))
    state = state.context ? resetOrder(state) : emptyState();
  const exactProduct = products.some(
    (p) => foldText(p.name) === foldText(text) || matchesSku(p.sku, text),
  );
  const intent = routeIntent(text);
  trace?.({ stage: "overview", label: "Intent routed", data: { intent, method: "Deterministic product / catalog / general router" } });
  const wantsDocument = intent === "catalog";
  const sources =
    (exactProduct || (state.product_id && !state.fields.catalog_context)) &&
    !wantsDocument
      ? null
      : await retrieveBusinessSources(
          params.businessId,
          text,
          state.fields.catalog_context,
          ...(trace ? [trace] : []),
        );
  const service =
    !state.product_id &&
    !exactProduct &&
    rankedKnowledge.find(
      (k) => k.entry.intent_key === "service" && k.score >= 0.7,
    );
  trace?.({ stage: "context", label: "Context retrieval completed", data: { sources, service: service ? service.entry : null } });
  if (params.informational !== undefined) {
    const trainingContext = trainingFor(null, null);
    const links = sources?.documents.map(d => `${d.title}: ${d.url}`).join("\n") ?? "";
    const generated = await generateAgentReply({
      businessProcess, trainingContext, ...(trace ? { onTrace: trace } : {}),
      instructions: (agent?.instructions || "Answer in the customer's language.") +
        (params.informational ? `\nBusiness owner's reply guidance: ${params.informational}` : ""),
      state, customerMessage: text, previousResponseId: null, knowledge: "", catalogSummary: "",
      documentContext: [state.visual ? `Customer supplied fields (not business policy): ${JSON.stringify(state.visual.values)}` : "", knowledge.map(k => `${k.title}: ${k.body}`).join("\n"),
        products.map(p => `${p.name}: ${shortenDescription(p.description)}${p.price_amount == null ? "" : ` — ${p.price_amount} ${p.currency}`}`).join("\n"),
        sources?.evidence, links].filter(Boolean).join("\n") || "No verified information available.",
      documentFallback: sources?.clarification || "Për këtë informacion, ju lutem kontaktoni ekipin.",
    });
    const missingLinks = sources?.documents.filter(d => !generated.reply.includes(d.url)).map(d => `${d.title}: ${d.url}`).join("\n");
    return { reply: generated.reply + (missingLinks ? `\n${missingLinks}` : ""), nextState: state,
      previousResponseId: null, workflowId: null, productName: null, workflowProgress: [],
      debug: { model: agentModel(), source: generated.source, fallbackReason: generated.fallbackReason,
        agentConfigured: Boolean(agent?.instructions), knowledgeCount: knowledge.length, productCount: products.length,
        workflowSteps: [], elapsedMs: Date.now() - started, trainingMemoryIds: trainingContext.rules.map(r => r.id),
        retrievedCatalogIds: sources?.documents.map(d => d.id) } };
  }
  if (!sources && service) {
    trace?.({ stage: "workflow", label: "Service information; workflow not advanced", data: { state, workflowId: null, steps: [] } });
    const trainingContext = trainingFor(null, null);
    const generated = await generateAgentReply({
    businessProcess,
      trainingContext,
      ...(trace ? { onTrace: trace } : {}),
      instructions: agent?.instructions || "Answer in the customer's language.",
      state,
      knowledge: "",
      customerMessage: text,
      previousResponseId: null,
      catalogSummary: "",
      documentContext: `Verified business service: ${service.entry.title}\n${service.entry.body}`,
      documentFallback: `${service.entry.title}: ${service.entry.body}`,
    });
    return {
      reply: generated.reply,
      nextState: state,
      previousResponseId: null,
      workflowId: null,
      productName: null,
      workflowProgress: [],
      debug: {
        model: agentModel(),
        source: generated.source,
        fallbackReason: generated.fallbackReason,
        agentConfigured: Boolean(agent?.instructions),
        knowledgeCount: knowledge.length,
        productCount: products.length,
        workflowSteps: [],
        retrievedService: true,
        trainingMemoryIds: generated.source === "ai" ? trainingContext.rules.map(rule => rule.id) : [],
        elapsedMs: Date.now() - started,
      },
    };
  }
  if (sources) {
    state.fields.catalog_context = sources.context;
    const currentProduct = products.find((p) => p.id === state.product_id);
    let currentWorkflow: string | null = null;
    let currentWorkflowName: string | null = null;
    if (currentProduct?.workflow_id) {
      const owned = await db
        .from("workflows")
        .select("id,name")
        .eq("business_id", params.businessId)
        .eq("id", currentProduct.workflow_id)
        .maybeSingle();
      if (owned.error) throw new Error("Nuk u ngarkua workflow.");
      currentWorkflow = owned.data?.id ?? null;
      currentWorkflowName = owned.data?.name ?? null;
    }
    if (trace) {
      // Read definitions for inspection only; the informational turn still never advances state.
      const definition = currentWorkflow ? await db.from("workflow_steps").select("key,kind,required").eq("workflow_id", currentWorkflow).order("position") : null;
      trace({ stage: "workflow", label: "Document information; workflow not advanced", data: { state, workflowId: currentWorkflow, workflowName: currentWorkflowName, previousStep: params.state?.step_key, steps: definition?.data ?? [], definitionError: definition?.error ? "Workflow definition unavailable" : null } });
    }
    // Document questions do not answer or advance an order workflow.
    const links = sources.documents
      .map((d) => `${d.title}: ${d.url}`)
      .join("\n");
    const trainingContext = trainingFor(currentWorkflow, state.step_key);
    const generated = sources.clarification
      ? {
          reply: sources.clarification,
          responseId: null,
          source: "fallback" as const,
          fallbackReason: "catalog_clarification",
        }
      : await generateAgentReply({
          businessProcess,
          trainingContext,
      ...(trace ? { onTrace: trace } : {}),
          instructions:
            agent?.instructions || "Answer in the customer's language.",
          state,
          customerMessage: `${sources.context.query}\nSqarime: ${JSON.stringify(sources.context.requirements)}\nMesazhi i fundit: ${text}`,
          previousResponseId: null,
          knowledge: knowledge.map((k) => `${k.title}: ${k.body}`).join("\n"),
          catalogSummary: "",
          documentContext: `${sources.evidence}\nVerified document links:\n${links}`,
          documentFallback: `Këtu është materiali më i përshtatshëm që gjeta. Për çmime, disponueshmëri ose specifikime që nuk gjenden në dokument, kontaktoni ekipin.\n${links}`,
        });
    // Always include the selected, server-validated document link, even if the model omits it.
    const missingLinks = sources.documents
      .filter((d) => !generated.reply.includes(d.url))
      .map((d) => `${d.title}: ${d.url}`)
      .join("\n");
    return {
      reply: generated.reply + (missingLinks ? `\n${missingLinks}` : ""),
      nextState: state,
      previousResponseId: null,
      workflowId: currentWorkflow,
      productName: currentProduct?.name ?? null,
      workflowProgress: [],
      debug: {
        model: agentModel(),
        source: generated.source,
        fallbackReason: generated.fallbackReason,
        agentConfigured: Boolean(agent?.instructions),
        knowledgeCount: knowledge.length,
        productCount: products.length,
        workflowSteps: [],
        elapsedMs: Date.now() - started,
        retrievedCatalogIds: sources.documents.map((d) => d.id),
        trainingMemoryIds: generated.source === "ai" ? trainingContext.rules.map(rule => rule.id) : [],
      },
    };
  }
  delete state.fields.catalog_context;
  let selected = products.find((p) => p.id === state.product_id) ?? null;
  if (state.product_id && !selected) state = state.context ? resetOrder(state) : emptyState();
  let justSelected = false;
  const orderRequest = params.orderRequest || detectVisualIntent(text) === "order";
  if (selected && orderRequest) {
    const requested = pickProduct(products,text);
    if (requested && requested.id !== selected.id) {
      state = state.context ? resetOrder(state) : {...emptyState(),customer:state.customer,recentMessages:state.recentMessages};
      selected=null;
    }
  }
  if (!selected && text) {
    const skuMatches = products.filter((p) => matchesSku(p.sku, text));
    const match =
      skuMatches.length === 1 ? skuMatches[0] : pickProduct(products, text);
    if (match) {
      selected = match;
      justSelected = true;
      state.product_id = selected.id;
      state.fields.product_query = text;
    }
  }
  // Type and workflow come from this tenant's product, never from client state.
  state.product_type_id = selected?.product_type_id ?? null;
  let workflowId: string | null = null;
  let workflowName: string | null = selected ? "Default customer collection" : null;
  let steps: WorkflowStepDef[] = [
    {
      key: "collect_customer",
      kind: "customer",
      label: "Të dhënat e klientit",
    },
  ];
  const pinnedOrder = selected && !justSelected ? readOrderSnapshot(state.orderWorkflowSnapshot, params.businessId, selected.id) : null;
  const pinned = state.context?.execution.linear ?? (pinnedOrder ? {
    id: pinnedOrder.workflowId, versionId: "sealed-order-snapshot", name: pinnedOrder.name, steps: pinnedOrder.steps,
  } : state.linearSnapshot);
  const resolvedWorkflowId = pinned?.id ?? (selected && !justSelected ? params.persistedWorkflowId : null) ?? selected?.workflow_id;
  if (pinned && state.product_id === selected?.id) {
    workflowId = pinned.id; workflowName = pinned.name; steps = pinned.steps;
    if (state.context) state.context.execution.linear = pinned;
  } else if (resolvedWorkflowId) {
    const workflow = await db
      .from("workflows")
      .select("id,name")
      .eq("id", resolvedWorkflowId)
      .eq("business_id", params.businessId)
      .maybeSingle();
    if (workflow.error) throw new Error("Nuk u ngarkua workflow.");
    if (workflow.data) {
      workflowId = workflow.data.id;
      workflowName = workflow.data.name;
      const result = await db
        .from("workflow_steps")
        .select("key,kind,position,config,required")
        .eq("workflow_id", workflowId)
        .order("position");
      if (result.error) throw new Error("Nuk u ngarkuan hapat e workflow-t.");
      if (params.requireConfiguredWorkflow && !result.data?.length) steps = [];
      if (result.data?.length)
        steps = result.data.map((s) => {
          const config = (s.config ?? {}) as { label?: string; prompt?: string; fieldKey?: string; fieldType?: WorkflowStepDef["fieldType"]; options?: string[] };
          return {
            key: s.key,
            fieldKey: config.fieldKey, prompt: config.prompt, fieldType: config.fieldType, options: config.options,
            required: s.required !== false,
            kind: s.kind as WorkflowStepKind,
            label:
              typeof config.label === "string" && config.label.trim()
                ? config.label.trim()
                : undefined,
          };
        });
    }
  }
  if (state.context && workflowId && !pinned) {
    const { data: definition, error } = await db.from("linear_workflow_versions").select("id,name,steps")
      .eq("business_id", params.businessId).eq("workflow_id", workflowId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !definition) throw new Error("Mungon versioni i workflow-t të produktit.");
    steps = definition.steps as WorkflowStepDef[];
    workflowName = definition.name;
    state.context.execution.linear = { id: workflowId, versionId: definition.id, name: definition.name, steps };
  }
  if (selected && workflowId && !pinnedOrder) {
    state.orderWorkflowSnapshot = sealOrderSnapshot({businessId:params.businessId,productId:selected.id,workflowId,name:workflowName ?? "Porosia",steps});
  }
  if (params.requireConfiguredWorkflow && selected && (!workflowId || !steps.length || workflowName === "Default customer collection")) {
    return { reply: "Ekipi do t’ju ndihmojë të vazhdoni me këtë produkt.", nextState: state, previousResponseId: null,
      workflowId: null, productName: selected.name, workflowProgress: [], handoff: true, advisoryHandoff: true,
      debug: { model: agentModel(), source: "fallback", fallbackReason: "workflow_not_configured", agentConfigured: Boolean(agent?.instructions), knowledgeCount: knowledge.length, productCount: products.length, workflowSteps: [], elapsedMs: Date.now() - started } };
  }
  let navigationReply: string | undefined;
  let informationalTurn = false;
  let revisiting = Boolean(orderRequest);
  if (selected && !justSelected && text) {
    const index = steps.findIndex(s=>s.key===state.step_key);
    const targets = steps.slice(0,index<0?steps.length:index).map(s=>({id:s.key,label:s.label??s.key,prompt:s.prompt,fieldKey:s.fieldKey}));
    const current = steps.find(s=>s.key===state.step_key);
    const guidance = await chooseGuidance({message:text,state,targets,routes:steps.map(s=>({id:s.key,label:s.label??s.key,prompt:s.prompt,fieldKey:s.fieldKey,kind:s.kind})),current:current?{id:current.key,label:current.label??current.key,prompt:current.prompt,fieldKey:current.fieldKey}:undefined});
    trace?.({stage:"workflow",label:"Order conversation guidance",data:guidance});
    if((guidance.action==="revisit" || guidance.action==="route") && guidance.target) {
      state.step_key=guidance.target;
      state.revisitStep=guidance.target;
      state.unorderedWorkflow=true;
      invalidateConfirmation(state);
      if(state.context && Object.keys(state.context.profile).length && steps.find(s=>s.key===guidance.target)?.kind==="customer") state.context.execution.profileConfirmation="pending";
      revisiting=true;
    } else if(guidance.action==="answer") informationalTurn=true;
    else if(guidance.action==="clarify") navigationReply=clarification(targets);
  }
  if (justSelected) {
    // Choosing a product is not an answer to its first workflow question.
    state.step_key = steps[0]?.key ?? "collect_customer";
  } else if (!selected) {
    if (text) state.fields.product_query = text;
    state.step_key = "choose_product";
  } else if (!state.context && !revisiting && !informationalTurn && !navigationReply) {
    state = applyInboundToState(state, text, params.hasPhoto, steps);
    if (state.step_key !== state.revisitStep) delete state.revisitStep;
  }

  if (state.context && selected && (!revisiting || justSelected) && !informationalTurn && !navigationReply) {
    const extracted=await extractMessageFacts(state,text,[...profileExtractionFields,...steps.filter(s=>!["confirm","customer","photo"].includes(s.kind)).map(s=>({key:s.fieldKey??s.key,type:s.fieldType??"text" as const,label:s.label,options:s.options}))]);
    state = advanceSharedOrder(state, text, params.hasPhoto, steps, justSelected,extracted);
  }
  if (state.unorderedWorkflow && ["order_ready","order_confirm"].includes(state.step_key ?? "")) {
    const missing = steps.find(step => {
      if (step.required === false) return false;
      if (step.kind === "customer") return !state.customer.name || !state.customer.phone || !state.customer.city || !state.customer.address;
      if (step.kind === "confirm") return !/^(po|ok|okay|yes|dakord|konfirmoj)[.!\s]*$/i.test(String(state.fields[step.key]??""));
      const value = state.context?.order[step.fieldKey??step.key]?.value ?? (step.fieldKey?.startsWith("customer_") ? state.context?.profile[step.fieldKey.slice(9) as import("@/lib/workflows/context").ProfileKey]?.value : undefined) ?? state.fields[step.key];
      return step.kind === "photo" ? value!==true && value!=="photo_received" : !value;
    });
    if (missing) { state.step_key=missing.key; invalidateConfirmation(state); }
  }
  if(state.context && !isQuestion(text) && state.step_key!=="order_ready") recordPrompt(state,state.step_key??"choose_product");
  const productName = selected?.name ?? null;
  const workflowProgress = buildWorkflowProgress({
    steps,
    state,
    productName,
  });

  trace?.({ stage: "workflow", label: "Workflow resolved", data: {
    workflowId, workflowName, previousStep: params.state?.step_key ?? "choose_product",
    state, steps, progress: workflowProgress, selectedProduct: selected,
  } });
  const trainingContext = trainingFor(workflowId, state.step_key);
  const generated = navigationReply ? {reply:navigationReply,responseId:params.previousResponseId??null,source:"fallback" as const,fallbackReason:"navigation_clarification"} : state.context && !informationalTurn && !isQuestion(text) ? { reply: sharedPrompt(state, steps, productName ?? undefined), responseId: null, source: "fallback" as const, fallbackReason: "shared_workflow_prompt" } : await generateAgentReply({
    businessProcess,
    trainingContext,
      ...(trace ? { onTrace: trace } : {}),
    instructions:
      (agent?.instructions || "You are a customer support agent. Write in the customer's language. Do not invent prices.") +
      (informationalTurn ? "\nAnswer the current informational question using only verified knowledge/catalog. Do not repeat the workflow prompt or advance the order." : ""),
    state,
    knowledge: knowledge.map((k) => `${k.title}: ${k.body}`).join("\n"),
    customerMessage: text || "[media]",
    previousResponseId: params.previousResponseId ?? null,
    catalogSummary: products
      .map((p) => {
        const price =
          p.price_amount == null ? "" : ` — ${p.price_amount} ${p.currency}`;
        const desc = shortenDescription(p.description);
        return desc ? `${p.name}${price} — ${desc}` : `${p.name}${price}`;
      })
      .join("\n"),
    workflowProgress,
  });
  return {
    reply: generated.reply,
    nextState: state,
    previousResponseId: generated.responseId,
    workflowId,
    productName,
    workflowProgress,
    debug: {
      model: agentModel(),
      source: generated.source,
      fallbackReason: generated.fallbackReason,
      agentConfigured: Boolean(agent?.instructions),
      knowledgeCount: knowledge.length,
      productCount: products.length,
      workflowSteps: steps.map((s) => s.key),
      trainingMemoryIds: generated.source === "ai" ? trainingContext.rules.map(rule => rule.id) : [],
      elapsedMs: Date.now() - started,
    },
  };
}
