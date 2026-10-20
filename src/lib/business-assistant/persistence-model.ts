import type { ActionPlan } from "./action-plan";
import type { AssistantUIContext } from "./context";
import type { Preview } from "./model";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import type { LinearDefinition } from "@/lib/workflows/linear";
import type { OrderFlow, OrderFlowProduct } from "./orderflow-service";

export type PlanningPreferences = Record<string, "included" | "deferred">;
export type RecoverablePlan = {
  version: 1;
  request: string;
  context?: AssistantUIContext;
  message?: string;
  actionPlan?: ActionPlan;
  preview?: Preview;
  target?: { kind: string; id: string; updatedAt?: string; revision?: number };
  visualDraft?: { graph: VisualGraph; revision: number };
  linearDraft?: { productId: string; definition: LinearDefinition; scope: string; source: string | null;
    revision: number; workflowId: string | null; versionId: string | null; sourceVersionId: string | null };
  orderDraft?: { action: string; source: OrderFlow | null; name: string; steps: OrderFlow["steps"]; products: OrderFlowProduct[]; scope: string };
};
export type StoredConversation = {
  id: string; title: string; revision: number; plan_revision: number; updated_at: string;
  pending_request: string | null; pending_since: string | null;
};
export type StoredMessage = {
  seq: number; request_id: string; role: "user" | "assistant";
  kind: "user" | "assistant" | "backend_outcome" | "interrupted";
  content: string; context: AssistantUIContext; created_at: string;
  outcome?: { action: string; reference: { table: string; id?: string; request_key?: string }; status: string } | null;
};
export type StoredPlan = { revision: number; snapshot: RecoverablePlan; preferences: PlanningPreferences };
export type ConversationView = {
  conversation: StoredConversation; messages: StoredMessage[]; before: number | null; plan: StoredPlan | null;
};
export function hasRecoverableWork(plan: RecoverablePlan | null | undefined) {
  return Boolean(plan && (plan.actionPlan || plan.preview || plan.visualDraft || plan.linearDraft || plan.orderDraft));
}

/** A whitelist at the envelope boundary plus recursive secret-key rejection.
 * Display text is untrusted user/model content, never evidence of execution. */
export function safePlanSnapshot(input: RecoverablePlan): RecoverablePlan {
  const allowed = { version: 1, request: input.request, context: input.context, message: input.message,
    actionPlan: input.actionPlan, preview: input.preview, target: input.target, visualDraft: input.visualDraft,
    linearDraft: input.linearDraft, orderDraft: input.orderDraft };
  const json = JSON.stringify(allowed, (key, value) =>
    /^(token|pendingToken|publicationApproval|authorization|password|api_key|secret|credentials|signedUrl)$/i.test(key) ? undefined : value);
  if (new TextEncoder().encode(json).length > 524288) throw new Error("Plani është tepër i madh për ruajtje.");
  return JSON.parse(json);
}
/** Bound descriptive recovery input separately from the durable snapshot.
 * Large drafts remain reviewable but must be narrowed before another model turn. */
export function modelPlanContext(plan: RecoverablePlan, preferences: PlanningPreferences = {}) {
  const context = { ...safePlanSnapshot(plan), planningPreferences: preferences };
  if (new TextEncoder().encode(JSON.stringify(context)).length > 64000)
    throw new Error("Plani i rikthyer është tepër i madh për një kërkesë. Rishikoje dhe nis një bisedë me një pjesë më të vogël.");
  return context;
}
export function planningPreferences(raw: unknown): PlanningPreferences {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Zgjedhje të pavlefshme.");
  const entries = Object.entries(raw);
  if (entries.length > 100 || entries.some(([key, value]) => !/^[a-zA-Z0-9_-]{1,80}$/.test(key) || !["included", "deferred"].includes(String(value))))
    throw new Error("Zgjedhje të pavlefshme.");
  return Object.fromEntries(entries) as PlanningPreferences;
}
export function modelHistory(messages: StoredMessage[]) {
  return messages.filter(m => m.kind !== "interrupted").slice(-8).map(m => ({
    role: m.role, content: m.kind === "backend_outcome" ? `Njoftim historik i serverit (jo leje për veprim të ri): ${m.content}` : m.content,
  })).map(m => ({ ...m, content: m.content.slice(0, 12000) }));
}
