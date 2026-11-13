import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/generate";
import { prompt } from "@/lib/ai/prompts/files";
import { zonedParts } from "@/lib/calendar/model";
import { compileProcessVersion, loadCurrentLinearVersions } from "@/lib/orchestration/version-store";
import { fieldPresentation, loadConversationContext, type ConversationContext } from "./context";

/**
 * "Krijo porosi", "Cakto takim" and "Ruaj kontaktin" read the conversation when
 * they open and come back filled: what the agent already collected first, then
 * what the AI finds in the latest messages, checked against the catalog and the
 * calendar. Read-only: nothing is created here; the owner reviews and saves
 * through each form's own route.
 */
export type FormKind = "order" | "booking" | "customer";
export const FORM_KINDS: FormKind[] = ["order", "booking", "customer"];

export const PREFILL_FIELDS = ["name", "phone", "email", "city", "address", "product_id", "quantity", "service_id", "date", "time", "note"] as const;
export type PrefillKey = (typeof PREFILL_FIELDS)[number];
export type PrefillValue = { value: string; source: "agjenti" | "biseda"; evidence: string };
export type Prefill = {
  fields: Partial<Record<PrefillKey, PrefillValue>>;
  productName: string | null;
  /** Required fields still empty, in the owner's words. */
  missing: string[];
  /** Extra details the business's workflow asks for (folded into the note). */
  workflowFields: string[];
  scanned: number;
};

const FORM_FIELDS: Record<FormKind, PrefillKey[]> = {
  order: ["product_id", "quantity", "name", "phone", "city", "address", "note"],
  booking: ["service_id", "date", "time", "name", "phone", "email", "note"],
  customer: ["name", "phone"],
};
const REQUIRED: Record<FormKind, [PrefillKey, string][]> = {
  order: [["product_id", "Produkti"], ["name", "Emri"], ["phone", "Telefoni"]],
  booking: [["service_id", "Shërbimi"], ["date", "Data"], ["time", "Ora"], ["name", "Emri"]],
  customer: [["name", "Emri"], ["phone", "Telefoni"]],
};
const MAX: Record<PrefillKey, number> = {
  name: 120, phone: 40, email: 200, city: 120, address: 300, product_id: 36, quantity: 3, service_id: 36, date: 10, time: 5, note: 1000,
};
const SPEAKERS = { customer: "klienti", staff: "biznesi", agent: "agjenti" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Catalog = { id: string; name: string }[];

/** One value from the model, kept only when it fits its field. */
export function checkValue(key: PrefillKey, raw: unknown, input: { products: Catalog; services: Catalog; today: string }): string {
  const value = typeof raw === "string" ? raw.trim().slice(0, MAX[key]) : "";
  if (!value) return "";
  switch (key) {
    case "product_id": return UUID.test(value) && input.products.some((p) => p.id === value) ? value : "";
    case "service_id": return UUID.test(value) && input.services.some((s) => s.id === value) ? value : "";
    case "quantity": return /^\d{1,3}$/.test(value) && Number(value) >= 1 ? String(Number(value)) : "";
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && value >= input.today ? value : "";
    case "time": return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
    case "phone": return /^\+?[\d\s().-]{6,}$/.test(value) && value.replace(/\D/g, "").length >= 6 ? value : "";
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
    default: return value;
  }
}

/** What the agent already collected and validated, per form field. */
export function collectedValues(context: ConversationContext, kind: FormKind): Partial<Record<PrefillKey, string>> {
  const profile = context.profile;
  const name = profile.name ?? context.customer.name ?? "";
  const phone = profile.phone ?? context.customer.phone ?? "";
  const values: Partial<Record<PrefillKey, string>> = { name, phone, email: profile.email ?? "", city: profile.city ?? "", address: profile.address ?? "" };
  if (kind === "order") {
    values.product_id = context.forms.order.productId ?? "";
    if (context.forms.order.productId) values.quantity = String(context.forms.order.quantity);
  }
  if (kind === "booking") {
    values.service_id = context.forms.booking.serviceId ?? "";
    values.date = context.forms.booking.date ?? "";
    values.time = context.forms.booking.time ?? "";
  }
  return values;
}

/** The agent's validated values win; the model fills what is still empty. */
export function mergePrefill(input: {
  kind: FormKind;
  collected: Partial<Record<PrefillKey, string>>;
  model: Partial<Record<PrefillKey, { value: string; evidence: string }>>;
}): { fields: Prefill["fields"]; missing: string[] } {
  const fields: Prefill["fields"] = {};
  for (const key of FORM_FIELDS[input.kind]) {
    const agent = input.collected[key]?.trim();
    const found = input.model[key];
    if (agent) fields[key] = { value: agent, source: "agjenti", evidence: "" };
    else if (found?.value) fields[key] = { value: found.value, source: "biseda", evidence: found.evidence.slice(0, 120) };
  }
  const missing = REQUIRED[input.kind].filter(([key]) => !fields[key]).map(([, label]) => label);
  return { fields, missing };
}

/** Labels of the details the business's product workflows ask customers for. */
async function workflowFieldLabels(businessId: string, processes: ConversationContext["processes"], kind: FormKind) {
  const labels = new Set<string>();
  for (const process of processes) for (const field of [...process.fields.map((f) => f.label), ...process.missing]) labels.add(field);
  if (kind === "order") {
    const versions = await loadCurrentLinearVersions(businessId).catch(() => []);
    for (const version of versions)
      for (const definition of compileProcessVersion(version))
        for (const field of definition.fields) {
          const label = fieldPresentation(field).label;
          if (label && !field.id.startsWith("customer_") && !/^(?:order|booking)_/.test(field.id)) labels.add(label);
        }
  }
  for (const known of ["Emri", "Telefoni", "Email", "Qyteti", "Adresa", "Produkti", "Sasia", "Shërbimi", "Data", "Ora", "Kontakti", "Çmimi për njësi"]) labels.delete(known);
  return [...labels].slice(0, 25);
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: [...PREFILL_FIELDS],
  properties: Object.fromEntries(PREFILL_FIELDS.map((key) => [key, {
    type: "object", additionalProperties: false, required: ["value", "evidence"],
    properties: { value: { type: "string" }, evidence: { type: "string" } },
  }])),
};

/** Null when the conversation is not in this business. */
export async function prefillForm(db: SupabaseClient, businessId: string, conversationId: string, kind: FormKind): Promise<Prefill | null> {
  const context = await loadConversationContext(db, businessId, conversationId);
  if (!context) return null;
  const [messages, products, calendar, workflowFields] = await Promise.all([
    db.from("messages").select("source,body,created_at").eq("business_id", businessId).eq("conversation_id", conversationId)
      .not("body", "is", null).in("source", ["customer", "staff", "agent"]).order("created_at", { ascending: false }).limit(40),
    kind === "order"
      ? db.from("products").select("id,name,price_amount,currency").eq("business_id", businessId).eq("is_active", true)
          .is("archived_at", null).not("price_amount", "is", null).order("name").limit(200)
      : Promise.resolve({ data: [] as { id: string; name: string; price_amount: number | null; currency: string | null }[], error: null }),
    db.from("business_calendar_settings").select("timezone").eq("business_id", businessId).maybeSingle(),
    workflowFieldLabels(businessId, context.processes, kind),
  ]);
  if (messages.error || products.error) throw new Error("prefill_unavailable");
  const timezone = calendar.data?.timezone ?? "Europe/Tirane";
  const now = zonedParts(new Date(), timezone);
  const today = now.date;
  const catalog = (products.data ?? []).map((p) => ({ id: p.id, name: p.name, price: p.price_amount, currency: p.currency }));
  const services = kind === "booking" ? context.forms.booking.services : [];
  const lines = (messages.data ?? []).reverse().map((m) => `${SPEAKERS[m.source as keyof typeof SPEAKERS]}: ${String(m.body).slice(0, 500)}`);
  const collected = collectedValues(context, kind);

  const model: Partial<Record<PrefillKey, { value: string; evidence: string }>> = {};
  if (lines.length && process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 40_000, maxRetries: 0 });
    const result = await client.responses.create({
      model: modelFor("assistant"), store: false,
      instructions: prompt("agjenti-i-klienteve/plotesimi-i-formave"),
      input: JSON.stringify({
        form: kind,
        today,
        now: now.time,
        timezone,
        catalog: catalog.map((p) => ({ id: p.id, name: p.name, price: p.price })),
        services,
        workflow_fields: workflowFields,
        collected: Object.fromEntries(Object.entries(collected).filter(([, value]) => value)),
        conversation: lines.join("\n"),
      }),
      text: { format: { type: "json_schema", name: "form_prefill", strict: true, schema } },
    });
    const raw = JSON.parse(result.output_text) as Record<string, { value?: unknown; evidence?: unknown }>;
    for (const key of FORM_FIELDS[kind]) {
      const value = checkValue(key, raw[key]?.value, { products: catalog, services, today });
      if (value) model[key] = { value, evidence: typeof raw[key]?.evidence === "string" ? String(raw[key].evidence).trim() : "" };
    }
  }

  const { fields, missing } = mergePrefill({ kind, collected, model });
  const productId = fields.product_id?.value;
  return {
    fields,
    productName: productId ? catalog.find((p) => p.id === productId)?.name ?? context.forms.order.productName : null,
    missing,
    workflowFields,
    scanned: lines.length,
  };
}
