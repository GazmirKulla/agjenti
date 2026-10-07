import type { TraceObserver } from "./trace";
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
export async function processAgentTurn(params: {
  onTrace?: TraceObserver;
  mode?: "production" | "test";
  source?: "instagram" | "admin_chat_lab";
  businessId: string;
  message: string;
  hasPhoto: boolean;
  state?: ConversationStatePayload | null;
  previousResponseId?: string | null;
}): Promise<AgentTurnResult> {
  const db = createServiceSupabase();
  const started = Date.now();
  const trace = params.onTrace;
  trace?.({ stage: "overview", label: "Message received", data: { input: params.message, mode: params.mode ?? "production", source: params.source ?? "instagram" } });
  const [productResult, agentResult, knowledgeResult] = await Promise.all([
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
  ]);
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
  const rankedKnowledge = rankKnowledge(
    knowledgeResult.data ?? [],
    params.message,
  );
  const knowledge = rankedKnowledge.slice(0, 12).map((k) => k.entry);
  trace?.({ stage: "context", label: "Business context loaded", data: {
    businessId: params.businessId, instructions: agent?.instructions ?? null,
    products, knowledge, previousState: params.state ?? emptyState(),
    previousResponseId: params.previousResponseId ?? null,
    history: "Production carries previous messages through previous_response_id; no local transcript or summary is loaded.",
  } });
  let state = structuredClone(params.state ?? emptyState());
  const text = params.message.trim();
  if (state.product_id && !products.some((p) => p.id === state.product_id))
    state = emptyState();
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
  if (!sources && service) {
    trace?.({ stage: "workflow", label: "Service information; workflow not advanced", data: { state, workflowId: null, steps: [] } });
    const generated = await generateAgentReply({
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
    const generated = sources.clarification
      ? {
          reply: sources.clarification,
          responseId: null,
          source: "fallback" as const,
          fallbackReason: "catalog_clarification",
        }
      : await generateAgentReply({
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
      },
    };
  }
  delete state.fields.catalog_context;
  let selected = products.find((p) => p.id === state.product_id) ?? null;
  if (state.product_id && !selected) state = emptyState();
  let justSelected = false;
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
  if (selected?.workflow_id) {
    const workflow = await db
      .from("workflows")
      .select("id,name")
      .eq("id", selected.workflow_id)
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
      if (result.data?.length)
        steps = result.data.map((s) => {
          const config = (s.config ?? {}) as { label?: string };
          return {
            key: s.key,
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
  if (justSelected) {
    // Choosing a product is not an answer to its first workflow question.
    state.step_key = steps[0]?.key ?? "collect_customer";
  } else if (!selected) {
    if (text) state.fields.product_query = text;
    state.step_key = "choose_product";
  } else {
    state = applyInboundToState(state, text, params.hasPhoto, steps);
  }

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
  const generated = await generateAgentReply({
      ...(trace ? { onTrace: trace } : {}),
    instructions:
      agent?.instructions ||
      "You are a customer support agent. Write in the customer's language. Do not invent prices.",
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
      elapsedMs: Date.now() - started,
    },
  };
}
