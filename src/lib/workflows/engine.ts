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
  recentMessages?: import("./guidance").ConversationMessage[];
  revisitStep?: string;
  orderWorkflowSnapshot?: string;
  linearSnapshot?: { id: string; versionId: string; name: string; steps: WorkflowStepDef[] };
  schemaVersion?: 2;
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

export function emptyState(): ConversationStatePayload {
  return {
    product_id: null,
    product_type_id: null,
    step_key: "choose_product",
    fields: {},
    customer: { name: null, phone: null, city: null, address: null },
  };
}

/** Fold Albanian/Latin text for loose product matching. */
export function foldText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ë/g, "e")
    .replace(/ç/g, "c")
    .trim();
}

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

function isAffirmative(text: string): boolean {
  const t = foldText(text);
  return /^(po|ok|okay|yes|yep|jo\s*problem|ne\s*rregull|ne rregull|konfirmoj|konfirmo|dakord|sure|po ju lutem|po faleminderit)[\s!.]*$/i.test(
    t,
  );
}

/** Extract customer fields from one free-text message when possible. */
export function parseCustomerMessage(text: string): {
  name: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
} {
  const raw = text.trim();
  const empty = { name: null, phone: null, city: null, address: null };
  if (!raw) return empty;

  const labeled: Record<string, string | null> = {
    name: null,
    phone: null,
    city: null,
    address: null,
  };
  const labelRe =
    /(?:^|[\n,;])\s*(emri|name|tel|telefon|phone|qyteti|city|adresa|address)\s*[:\-]\s*([^\n,;]+)/gi;
  for (const match of raw.matchAll(labelRe)) {
    const key = foldText(match[1]);
    const value = match[2].trim();
    if (!value) continue;
    if (key === "emri" || key === "name") labeled.name = value;
    else if (key === "tel" || key === "telefon" || key === "phone")
      labeled.phone = value;
    else if (key === "qyteti" || key === "city") labeled.city = value;
    else if (key === "adresa" || key === "address") labeled.address = value;
  }
  if (labeled.name || labeled.phone || labeled.city || labeled.address) {
    return labeled as {
      name: string | null;
      phone: string | null;
      city: string | null;
      address: string | null;
    };
  }

  const phoneMatch = raw.match(
    /(?:\+?\d[\d\s().-]{6,}\d)/,
  );
  const phone = phoneMatch?.[0]?.replace(/\s+/g, " ").trim() ?? null;

  const lines = raw
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 4) {
    return {
      name: lines[0],
      phone: phone || lines[1],
      city: lines[2],
      address: lines.slice(3).join(", "),
    };
  }

  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 4) {
    return {
      name: parts[0],
      phone: phone || parts[1],
      city: parts[2],
      address: parts.slice(3).join(", "),
    };
  }

  if (phone && parts.length >= 2) {
    const withoutPhone = parts.filter((p) => !p.includes(phone.replace(/\s/g, "")) && p !== phone);
    // Single-field fallback handled by caller
    if (withoutPhone.length >= 3) {
      return {
        name: withoutPhone[0],
        phone,
        city: withoutPhone[1],
        address: withoutPhone.slice(2).join(", "),
      };
    }
  }

  return empty;
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
  switch (stepKey) {
    case "choose_product":
      return "Cilin produkt dëshironi?";
    case "collect_theme":
      return "Cilin personazh ose temë doni në produkt?";
    case "awaiting_confirm":
      return "A e konfirmoni këtë zgjedhje?";
    case "awaiting_photo":
      return "Na dërgoni foton që do të përdorim.";
    case "collect_size":
      return "Çfarë madhësie doni?";
    case "collect_pieces":
      return "Sa copëza doni?";
    case "collect_age":
      return "Sa vjeç është fëmija?";
    case "collect_tray":
      return "A doni tabaka?";
    case "collect_color":
      return "Çfarë ngjyre doni?";
    case "collect_customer":
      return "Na jepni emrin, telefonin, qytetin dhe adresën.";
    case "confirm_product":
      return "A e konfirmoni porosinë e këtij produkti?";
    case "order_ready":
      return "Porosia është gati. Stafi ose agjenti mund ta konfirmojë.";
    default:
      return "Si mund t'ju ndihmoj?";
  }
}

export function stepLabel(step: WorkflowStepDef): string {
  if (step.label?.trim()) return step.label.trim();
  const fromPrompt = promptForStep(step.key);
  if (fromPrompt !== "Si mund t'ju ndihmoj?") return fromPrompt;
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
