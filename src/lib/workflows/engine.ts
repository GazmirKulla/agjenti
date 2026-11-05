export { emptyState, foldText } from "./state";
import { messageUnderstanding } from "@/lib/conversations/understanding/context";
import { historicalStepPrompt } from "./compatibility-prompts";
export const PUZZLE_STEPS = [
  { key: "collect_theme", kind: "text" as const, label: "Personazhi" },
  { key: "awaiting_confirm", kind: "confirm" as const, label: "Konfirmim" },
  { key: "awaiting_photo", kind: "photo" as const, label: "Foto" },
  { key: "collect_size", kind: "choice" as const, label: "Madhësi" },
  { key: "collect_pieces", kind: "choice" as const, label: "Copëza" },
  { key: "collect_age", kind: "text" as const, label: "Mosha" },
  { key: "collect_tray", kind: "confirm" as const, label: "Tabaka" },
  { key: "collect_customer", kind: "customer" as const, label: "Adresa" },
];

export const APPAREL_STEPS = [
  { key: "collect_size", kind: "choice" as const, label: "Madhësi" },
  { key: "collect_color", kind: "choice" as const, label: "Ngjyra" },
  { key: "collect_customer", kind: "customer" as const, label: "Adresa" },
];

export const SIMPLE_STEPS = [
  { key: "confirm_product", kind: "confirm" as const, label: "Konfirmim" },
  { key: "collect_customer", kind: "customer" as const, label: "Adresa" },
];

export type WorkflowStepKind =
  | "choice"
  | "text"
  | "photo"
  | "customer"
  | "confirm";

export type WorkflowStepDef = {
  fieldKey?: string;
  prompt?: string;
  fieldType?: "text" | "email" | "phone" | "number" | "photo";
  options?: string[];
  required?: boolean;
  key: string;
  kind: WorkflowStepKind;
  label?: string;
};

export type ConversationStatePayload = {
  /** Authoritative replacement runtime. Other properties are presentation/transport compatibility only. */
  runtime?: import("@/lib/orchestration/contracts").Snapshot;
  pendingCustomerQuestion?: import("./customer-question").PendingCustomerQuestion;
  /** Bounded duplicate-input fingerprint, no copy of customer data. */
  lastCustomerAnswerHash?: string;
  /** Single conversation's declared facts, not a reusable identity/profile. */
  customerDeclaredFacts?: import("./customer-declared-facts").CustomerDeclaredFacts;
  entityPresentation?: import("@/lib/products/entity-bridge").EntityPresentation;
  /** Staff ownership requested by the engine; transport commits the pause before acknowledgement. */
  staffHandoff?: boolean;
  /** Customer acknowledged information or deferred; explicit intent is needed to resume. */
  conversationPaused?: boolean;
  recentMessages?: import("./guidance").ConversationMessage[];
  revisitStep?: string;
  unorderedWorkflow?: boolean;
  orderWorkflowSnapshot?: string;
  linearSnapshot?: { id: string; versionId: string; name: string; steps: WorkflowStepDef[] };
  schemaVersion?: 2 | 3;
  processes?: import("./conversation-processes").ConversationProcesses;
  context?: import("./context").SharedContext;
  visual?: import("./visual/types").VisualRunState;
  completedVisual?: import("./visual/types").VisualRunState;
  product_id?: string | null;
  product_type_id?: string | null;
  step_key?: string | null;
  fields: Record<string, unknown>;
  customer: {
    name: string | null;
    phone: string | null;
    city: string | null;
    address: string | null;
  };
};

export type WorkflowProgressItem = {
  key: string;
  label: string;
  kind: WorkflowStepKind | "product" | "order";
  status: "done" | "current" | "pending";
  value: string | null;
};

export function nextStepKey(
  current: string | null | undefined,
  steps: { key: string }[],
): string | null {
  if (!current || current === "choose_product") {
    return steps[0]?.key ?? "collect_customer";
  }
  const idx = steps.findIndex((step) => step.key === current);
  if (idx < 0) return steps[0]?.key ?? null;
  return steps[idx + 1]?.key ?? "order_ready";
}

function isAffirmative(text: string): boolean { return messageUnderstanding(text).act === "accept"; }

/** Extract customer fields from one free-text message when possible. */
export function parseCustomerMessage(text: string): { name: string | null; phone: string | null; city: string | null; address: string | null } {
  const result = { name: null, phone: null, city: null, address: null } as { name: string | null; phone: string | null; city: string | null; address: string | null };
  for (const f of messageUnderstanding(text).facts) if (Object.hasOwn(result, f.key)) result[f.key as keyof typeof result] = f.value;
  return result;
}

function customerComplete(customer: ConversationStatePayload["customer"]) {
  return Boolean(
    customer.name?.trim() &&
      customer.phone?.trim() &&
      customer.city?.trim() &&
      customer.address?.trim(),
  );
}

export function applyInboundToState(
  state: ConversationStatePayload,
  text: string,
  hasPhoto: boolean,
  steps: WorkflowStepDef[],
): ConversationStatePayload {
  const next = {
    ...state,
    fields: { ...state.fields },
    customer: { ...state.customer },
  };
  const trimmed = text.trim();
  if (!next.product_id && trimmed) {
    next.fields.product_query = trimmed;
    next.step_key = steps[0]?.key ?? "collect_customer";
    return next;
  }
  const key = next.step_key ?? steps[0]?.key;
  const step = steps.find((item) => item.key === key);
  if (!step) {
    next.step_key = "order_ready";
    return next;
  }
  if (step.kind === "photo") {
    if (hasPhoto) {
      next.fields.photo = true;
      next.fields[step.key] = true;
      next.step_key = nextStepKey(step.key, steps);
    }
    return next;
  }
  if (step.kind === "customer") {
    const parsed = parseCustomerMessage(trimmed);
    if (parsed.name || parsed.phone || parsed.city || parsed.address) {
      if (parsed.name) next.customer.name = parsed.name;
      if (parsed.phone) next.customer.phone = parsed.phone;
      if (parsed.city) next.customer.city = parsed.city;
      if (parsed.address) next.customer.address = parsed.address;
    } else if (trimmed) {
      if (!next.customer.name) next.customer.name = trimmed;
      else if (!next.customer.phone) next.customer.phone = trimmed;
      else if (!next.customer.city) next.customer.city = trimmed;
      else if (!next.customer.address) next.customer.address = trimmed;
    }
    if (customerComplete(next.customer)) {
      next.step_key = "order_ready";
    }
    return next;
  }
  if (step.kind === "confirm") {
    if (trimmed && isAffirmative(trimmed)) {
      next.fields[step.key] = trimmed;
      next.step_key = nextStepKey(step.key, steps);
    }
    return next;
  }
  if (trimmed) {
    next.fields[step.key] = trimmed;
    next.step_key = nextStepKey(step.key, steps);
  }
  return next;
}

export function promptForStep(stepKey: string | null | undefined): string {
  return historicalStepPrompt(stepKey) ?? "Si mund t'ju ndihmoj?";
}

export function stepLabel(step: WorkflowStepDef): string {
  if (step.label?.trim()) return step.label.trim();
  const fromPrompt = historicalStepPrompt(step.key);
  if (fromPrompt !== null) return fromPrompt;
  return step.key.replace(/_/g, " ");
}

export function buildWorkflowProgress(params: {
  steps: WorkflowStepDef[];
  state: ConversationStatePayload;
  productName?: string | null;
}): WorkflowProgressItem[] {
  const { steps, state, productName } = params;
  const current = state.step_key || "choose_product";
  const orderReady = current === "order_ready";
  const stepIndex = steps.findIndex((s) => s.key === current);

  const items: WorkflowProgressItem[] = [
    {
      key: "choose_product",
      label: "Zgjidh produktin",
      kind: "product",
      status: state.product_id
        ? current === "choose_product"
          ? "current"
          : "done"
        : "current",
      value: productName || (state.fields.product_query as string) || null,
    },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let status: WorkflowProgressItem["status"] = "pending";
    if (orderReady || (stepIndex >= 0 && i < stepIndex)) status = "done";
    else if (step.key === current) status = "current";

    let value: string | null = null;
    if (step.kind === "customer") {
      const c = state.customer;
      if (c.name || c.phone || c.city || c.address) {
        value = [c.name, c.phone, c.city, c.address]
          .filter(Boolean)
          .join(" · ");
      }
    } else if (step.kind === "photo") {
      value = state.fields.photo || state.fields[step.key] ? "Foto e marrë" : null;
    } else {
      const raw = state.fields[step.key];
      value = raw == null || raw === "" ? null : String(raw);
    }

    items.push({
      key: step.key,
      label: stepLabel(step),
      kind: step.kind,
      status,
      value,
    });
  }

  items.push({
    key: "order_ready",
    label: "Porosia gati",
    kind: "order",
    status: orderReady ? "done" : "pending",
    value: orderReady ? "E plotësuar" : null,
  });

  return items;
}
