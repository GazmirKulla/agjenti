import { agentModel, generateAgentReply } from "@/lib/agents/generate";
import { shortenDescription } from "@/lib/products/parse";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  applyInboundToState,
  emptyState,
  type ConversationStatePayload,
  type WorkflowStepKind,
} from "@/lib/workflows/engine";

export type AgentTurnResult = {
  reply: string;
  nextState: ConversationStatePayload;
  previousResponseId: string | null;
  workflowId: string | null;
  debug: {
    model: string;
    source: "ai" | "fallback";
    fallbackReason: string | null;
    agentConfigured: boolean;
    knowledgeCount: number;
    productCount: number;
    workflowSteps: string[];
    elapsedMs: number;
  };
};

/** Shared business reply pipeline. Reads business context and calls AI only.
 * No inbox writes, order creation, Instagram connection lookup or Meta sends.
 * Caller is responsible for authorization and, for real turns, persistence/send.
 */
export async function processAgentTurn(params: {
  businessId: string;
  message: string;
  hasPhoto: boolean;
  state?: ConversationStatePayload | null;
  previousResponseId?: string | null;
}): Promise<AgentTurnResult> {
  const db = createServiceSupabase();
  const started = Date.now();
  const [productResult, agentResult, knowledgeResult] = await Promise.all([
    db
      .from("products")
      .select(
        "id,name,description,product_type_id,workflow_id,price_amount,currency",
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
      .select("title,body")
      .eq("business_id", params.businessId)
      .eq("is_active", true)
      .order("sort_order")
      .limit(12),
  ]);
  if (productResult.error || agentResult.error || knowledgeResult.error)
    throw new Error("Nuk u ngarkua konfigurimi i agjentit.");
  const products = productResult.data ?? [];
  const agent = agentResult.data;
  const knowledge = knowledgeResult.data ?? [];
  let state = structuredClone(params.state ?? emptyState());
  const text = params.message.trim();
  let selected = products.find((p) => p.id === state.product_id);
  if (state.product_id && !selected) state = emptyState();
  let justSelected = false;
  if (!selected && text) {
    const normalized = text.toLocaleLowerCase();
    // Preserve substring lookup; prefer exact names and never choose an ambiguous product.
    const exact = products.filter(
      (p) => p.name.toLocaleLowerCase() === normalized,
    );
    const candidates = exact.length
      ? exact
      : products.filter((p) => p.name.toLocaleLowerCase().includes(normalized));
    if (candidates.length === 1) {
      selected = candidates[0];
      justSelected = true;
      state.product_id = selected.id;
    }
  }
  // Type and workflow come from this tenant's product, never from client state.
  state.product_type_id = selected?.product_type_id ?? null;
  let workflowId: string | null = null;
  let steps: { key: string; kind: WorkflowStepKind }[] = [
    { key: "collect_customer", kind: "customer" },
  ];
  if (selected?.workflow_id) {
    const workflow = await db
      .from("workflows")
      .select("id")
      .eq("id", selected.workflow_id)
      .eq("business_id", params.businessId)
      .maybeSingle();
    if (workflow.error) throw new Error("Nuk u ngarkua workflow.");
    if (workflow.data) {
      workflowId = workflow.data.id;
      const result = await db
        .from("workflow_steps")
        .select("key,kind,position")
        .eq("workflow_id", workflowId)
        .order("position");
      if (result.error) throw new Error("Nuk u ngarkuan hapat e workflow-t.");
      if (result.data?.length)
        steps = result.data.map((s) => ({
          key: s.key,
          kind: s.kind as WorkflowStepKind,
        }));
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
  const generated = await generateAgentReply({
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
  });
  return {
    reply: generated.reply,
    nextState: state,
    previousResponseId: generated.responseId,
    workflowId,
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
