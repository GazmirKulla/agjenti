import { foldText, type ConversationStatePayload } from "@/lib/workflows/engine";
import { migrateContext, profileKeys, safeFieldKey, validValue, type Fact } from "@/lib/workflows/context";
import { currentProcessOwner } from "@/lib/workflows/conversation-processes";
import { customerDeclaredKeys, validDeclaredValue } from "@/lib/workflows/customer-declared-facts";
import { validDate, validTime } from "@/lib/calendar/model";
import type { BookingDraft } from "@/lib/calendar/agent";
import { customerFactReference, type CustomerFactReference } from "./customer-fact-reference";

type Domain = "order" | "service" | "booking" | "auxiliary";
type ProjectedFact = { value: string; type: Fact["type"]; source: string; validated: true; truncated?: true; authority: "customer_declared" | "legacy_unverified" };
export type CustomerContext = {
  reference?: CustomerFactReference;
  profile: Record<string, ProjectedFact>;
  declared: Record<string, ProjectedFact>;
  /** Presence prevents re-asking without disclosing unrelated contact values. */
  suppliedProfileKeys?: string[];
  process?: { kind: Domain; id: string | null; versionId: string | null; status: string;
    fields: Record<string, ProjectedFact>; entity?: { kind: "product" | "service"; id: string };
    /** Collection is not availability, approval, handoff or execution evidence. */
    authority: "collected_preferences_only" };
  diagnostic?: "staff_owned" | "ambiguous_process";
};
const secrets = /(?:password|secret|token|credential|authorization|api_key|ssn)/i;
const contact = /(?:phone|telefon|contact|email|address|adres|name|emri|customer_|recipient)/i;
const own = /\b(?:im|ime|tim|time|mia|mua|quhem|dhashe|dhene|thene|kam|marr|my|mine|provided)\b/;
function fact(value: Fact | undefined): ProjectedFact | undefined {
  if (!value || value.validated !== true || typeof value.value !== "string" || typeof value.source !== "string"
    || !["text", "number", "phone", "email"].includes(value.type) || !validValue(value.value, value.type)) return;
  // Legacy source strings may contain a whole message (including unrelated PII).
  // Keep the extraction method, not the raw evidence a second time in the prompt.
  const source = value.source.startsWith("message:") ? "message_evidence" : value.source;
  const declared = /^(?:message(?:_|$)|customer_declaration$|correction$|(?:visual|step):|booking_preference$)/.test(source);
  return { value: value.value.slice(0, 300), type: value.type,
    source: /^[a-z_]{1,60}$/.test(source) || /^(?:visual|step):[a-zA-Z0-9_-]{1,80}$/.test(source) ? source : "legacy_source",
    ...(value.value.length > 300 ? { truncated: true as const } : {}),
    validated: true, authority: declared ? "customer_declared" : "legacy_unverified" };
}
function mentions(text: string, key: string) {
  const words = foldText(key).replace(/^customer_/, "").split(/[_\s]+/).filter(w => w.length > 2);
  return words.length > 0 && words.every(word => text.includes(word));
}
type Candidate = { kind: Domain; id: string | null; versionId: string | null; status: string;
  fields: Record<string, Fact>; invalid?: string[]; entity?: { kind: "product" | "service"; id: string } };

/** Pure projection, never an authorization decision. Call only with the state
 * already scoped by the coordinator/session boundary. No DB, globals or caches.
 * Process names here select evidence, not routing, resumption or execution. */
export function projectCustomerContext(input: ConversationStatePayload, message: string, now = Date.now()): CustomerContext {
  // Legacy v1 values remain readable via the existing migration, on a clone.
  const state = input.context ? input : migrateContext(input);
  const out: CustomerContext = { profile: {}, declared: {} };
  if (state.staffHandoff || state.visual?.status === "handoff" && !state.visual.advisory) return { ...out, diagnostic: "staff_owned" };
  const text = foldText(message), reference = customerFactReference(message, state), ownQuestion = own.test(text) || Boolean(reference);
  if (reference) out.reference = reference;
  out.suppliedProfileKeys = profileKeys.filter(key => Boolean(fact(state.context?.profile[key])));
  for (const key of profileKeys) {
    // Broad recall intentionally excludes contact/address; explicit own questions can include them.
    if (!reference?.keys.includes(key)) continue;
    const f = fact(state.context?.profile[key]); if (f) out.profile[key] = f;
  }
  for (const key of customerDeclaredKeys) {
    if (!reference?.keys.includes(key)) continue;
    const raw = state.customerDeclaredFacts?.[key];
    const f = raw && validDeclaredValue(key, raw.value) ? fact(raw) : undefined;
    if (f) out.declared[key] = f;
  }
  const candidates: Candidate[] = [], p = state.processes, owner = state.context?.execution.factOwner;
  const visualOK = (visual: ConversationStatePayload["visual"], version?: string) => !visual
    || visual.status !== "handoff" && (!version || visual.versionId === version);
  const order = p?.order;
  if (order && ["active", "suspended"].includes(order.status)) {
    const s = order.snapshot, live = owner === "order" && !p?.auxiliary;
    const v = live ? state.visual : s.visual;
    const version = s.visual?.versionId ?? s.execution.linear?.versionId ?? s.linearSnapshot?.versionId;
    if (visualOK(v, version)) candidates.push({ kind: "order", id: order.id, versionId: version ?? null, status: order.status,
      fields: live ? state.context?.order ?? {} : s.order, invalid: (live ? state.context?.execution : s.execution)?.invalidFields,
      entity: (live ? state.product_id : s.product_id) ? { kind: "product", id: (live ? state.product_id : s.product_id)! } : undefined });
  }
  const service = p?.service;
  if (service && ["active", "suspended"].includes(service.status) && visualOK(service.visual, service.versionId)) {
    const live = owner === "service" && state.visual?.versionId === service.versionId && !p?.auxiliary;
    candidates.push({ kind: "service", id: service.id, versionId: service.versionId, status: service.status,
      fields: live ? state.context?.order ?? {} : service.order, invalid: live ? state.context?.execution.invalidFields : undefined,
      entity: service.visual.binding?.entity });
  }
  const booking = p?.booking;
  if (booking && ["active", "suspended"].includes(booking.status) && visualOK(booking.visual, booking.versionId)) {
    const draft = owner === "booking" && state.fields.booking ? state.fields.booking as BookingDraft : booking.draft;
    if (draft && draft.nonce === booking.id && Number.isFinite(draft.expires) && draft.expires > now && ["collect", "confirm"].includes(draft.phase)) {
      const fields: Record<string, Fact> = {};
      for (const key of ["date", "time", "name", "contact"] as const) {
        const value = draft[key];
        if (value && (key === "date" ? validDate(value) : key === "time" ? validTime(value) : validValue(value, "text")))
          fields[key] = { value, type: "text", source: "booking_preference", validated: true };
      }
      candidates.push({ kind: "booking", id: booking.id, versionId: booking.versionId ?? booking.visual?.versionId ?? null, status: booking.status, fields,
        entity: draft.serviceId ? { kind: "service", id: draft.serviceId } : undefined });
    }
  }
  // Legacy/current adapter compatibility: never fall back to a completed/deleted v3 process.
  if ((state.context && (!p || !owner) && !p?.order && !p?.service && !p?.booking) || owner === "auxiliary") {
    candidates.push({ kind: "auxiliary", id: null, versionId: state.visual?.versionId ?? null, status: "current",
      fields: state.context?.order ?? {}, invalid: state.context?.execution.invalidFields });
  }
  const domains: Domain[] = [];
  if (/\b(?:porosi\w*|order)\b/.test(text)) domains.push("order");
  if (/\b(?:sherbim\w*|service)\b/.test(text)) domains.push("service");
  if (/\b(?:rezerv\w*|takim\w*|booking|appointment)\b/.test(text)) domains.push("booking");
  let selected: Candidate | undefined;
  if (domains.length === 1) selected = candidates.find(c => c.kind === domains[0]);
  else if (domains.length > 1) return { ...out, diagnostic: "ambiguous_process" };
  else {
    const matches = candidates.filter(c => Object.keys(c.fields).some(key => mentions(text, key)));
    if (matches.length > 1) return { ...out, diagnostic: "ambiguous_process" };
    selected = matches[0] ?? candidates.find(c => c.kind === (currentProcessOwner(state) ?? p?.active ?? owner));
    if (!selected && !p) selected = candidates.find(c => c.kind === "auxiliary");
  }
  if (selected) {
    const fields: Record<string, ProjectedFact> = {};
    for (const key of Object.keys(selected.fields).sort()) {
      if (Object.keys(fields).length >= 24) break;
      if (!safeFieldKey(key) || secrets.test(key) || selected.invalid?.includes(key) || key.startsWith("customer_")) continue;
      const f = fact(selected.fields[key]); if (!f) continue;
      if ((contact.test(key) || ["phone", "email"].includes(f.type)) && !(ownQuestion && mentions(text, key))) continue;
      // Suspended tasks are shown only for an explicit domain or field request.
      if (selected.status === "suspended" && !domains.length && !mentions(text, key)) continue;
      if (selected.kind === "booking") f.authority = "customer_declared";
      fields[key] = f;
    }
    out.process = { kind: selected.kind, id: selected.id, versionId: selected.versionId, status: selected.status,
      fields, entity: selected.entity ? { ...selected.entity } : undefined, authority: "collected_preferences_only" };
  }
  return out;
}

/** Remove known unrelated contact facts from recent context, without expanding
 * the history window or treating assistant prose as canonical evidence. */
export function redactUnrequestedContact(text: string, state: ConversationStatePayload, projection: CustomerContext) {
  for (const key of profileKeys) {
    if (projection.profile[key]) continue;
    const value = state.context?.profile[key]?.value ?? (!state.context && key !== "email" ? state.customer[key] : undefined);
    if (value) text = text.split(value).join("[customer detail omitted]");
  }
  return text;
}
