import { createHash } from "node:crypto";
import { TransitionError, type Field, type ProcessDefinition, type Step, type Value } from "./contracts";

const forbidden = new Set(["__proto__", "constructor", "prototype"]);
export function validKey(value: string): boolean { return /^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(value) && !forbidden.has(value); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, limit = 4000): value is string { return typeof value === "string" && value.length > 0 && value.length <= limit; }
function shape(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function stepShape(s: unknown): boolean {
  if (!record(s) || !text(s.id, 120)) return false;
  switch (s.kind) {
    case "collect": return shape(s, ["id", "kind", "fieldId", "next"], ["prompt"]) && (s.prompt === undefined || text(s.prompt)) && text(s.fieldId) && text(s.next);
    case "condition": return shape(s, ["id", "kind", "fieldId", "operator", "yes", "no"], ["value"]) && text(s.fieldId) && text(s.yes) && text(s.no);
    case "semantic_condition": return shape(s, ["id", "kind", "predicate", "yes", "no"]) && text(s.predicate) && text(s.yes) && text(s.no);
    case "confirm": return shape(s, ["id", "kind", "fieldIds", "yes", "no", "label"], ["requiredFieldIds"]) && Array.isArray(s.fieldIds) && s.fieldIds.every(id => text(id, 120)) && (s.requiredFieldIds === undefined || Array.isArray(s.requiredFieldIds) && s.requiredFieldIds.every(id => text(id, 120))) && text(s.yes) && text(s.no) && text(s.label);
    case "inform": return shape(s, ["id", "kind", "next"]) && text(s.next);
    case "effect": return shape(s, ["id", "kind", "tool", "toolVersion", "inputs", "next", "failed"]) && text(s.tool, 200) && Number.isSafeInteger(s.toolVersion) && record(s.inputs) && Object.values(s.inputs).every(id => text(id, 120)) && text(s.next) && text(s.failed);
    case "message": return shape(s, ["id", "kind", "text", "next"]) && text(s.text) && text(s.next);
    case "wait": return shape(s, ["id", "kind", "eventType", "timeoutMs", "next", "expired"]) && text(s.eventType) && typeof s.timeoutMs === "number" && text(s.next) && text(s.expired);
    case "end": case "handoff": return shape(s, ["id", "kind", "label"]) && text(s.label);
    default: return false;
  }
}
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, canonical(item)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function validFieldValue(field: Field, value: Value): boolean {
  if (field.type === "photo") return value === true;
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
  if (field.type === "choices") return Array.isArray(value) && value.length > 0 && value.length <= 32 && new Set(value).size === value.length && value.every(v => field.options?.includes(v));
  if (typeof value !== "string" || !value.trim() || value.length > (field.max ?? 2000) || value.length < (field.min ?? 1)) return false;
  switch (field.type) {
    case "email": return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case "phone": return /^\+?[\d\s().-]{7,24}$/.test(value) && value.replace(/\D/g, "").length >= 7;
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    case "time": return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    case "choice": case "reference": return Boolean(field.options?.includes(value));
    case "text": return true;
    default: return false;
  }
}
export function destinations(step: Step): string[] {
  switch (step.kind) {
    case "condition": case "semantic_condition": case "confirm": return [step.yes, step.no];
    case "effect": return [step.next, step.failed];
    case "wait": return [step.next, step.expired];
    case "collect": case "message": case "inform": return [step.next];
    default: return [];
  }
}
/** Validate immutable definitions before exposing them to either the model or runtime. */
export function validateDefinition(definition: unknown): ProcessDefinition {
  if (!record(definition) || !shape(definition, ["id", "versionId", "businessId", "name", "purpose", "offerPolicy", "entry", "fields", "steps"], ["policyKey", "collection"])
    || !text(definition.id, 200) || !text(definition.versionId, 200) || !text(definition.businessId, 200) || !text(definition.name, 200)
    || !text(definition.purpose) || !text(definition.entry, 120) || !Array.isArray(definition.fields) || definition.fields.length > 64
    || !Array.isArray(definition.steps) || definition.steps.length > 128 || !definition.steps.every(stepShape)
    || !definition.fields.every(f => record(f) && shape(f, ["id", "subject", "label", "type", "required"], ["options", "min", "max", "source"])
      && (f.source === undefined || f.source === "customer" || f.source === "server")
      && text(f.id, 120) && text(f.subject, 120) && text(f.label, 200) && text(f.type, 30) && typeof f.required === "boolean"
      && (f.options === undefined || Array.isArray(f.options) && f.options.length <= 100 && f.options.every(o => text(o, 200)))
      && (f.min === undefined || typeof f.min === "number") && (f.max === undefined || typeof f.max === "number"))) throw new TransitionError("invalid_definition");
  const d = definition as unknown as ProcessDefinition;
  if (d.policyKey !== undefined && !/^[a-f0-9]{64}$/.test(d.policyKey)) throw new TransitionError("invalid_process_policy");
  if (d.collection && (!record(d.collection) || !shape(d.collection, ["domain", "revision", "profileFields"])
    || !["order", "service", "booking"].includes(d.collection.domain) || !Number.isSafeInteger(d.collection.revision) || d.collection.revision < 1
    || !Array.isArray(d.collection.profileFields) || d.collection.profileFields.some(k => !["name", "phone", "email", "city", "address"].includes(k)))) throw new TransitionError("invalid_process_policy");
  if (!d.id || !d.versionId || !d.businessId || !d.name.trim() || d.name.length > 200 || d.purpose.length > 4000
    || !["on_request", "when_relevant"].includes(d.offerPolicy) || !d.steps.length || d.steps.length > 128 || d.fields.length > 64) throw new TransitionError("invalid_definition");
  const fields = new Map(d.fields.map(f => [f.id, f]));
  const steps = new Map(d.steps.map(s => [s.id, s]));
  if (fields.size !== d.fields.length || steps.size !== d.steps.length || !steps.has(d.entry)) throw new TransitionError("duplicate_or_missing_definition_id");
  for (const f of d.fields) {
    if (!validKey(f.id) || !validKey(f.subject) || !f.label.trim() || typeof f.required !== "boolean"
      || !["text", "email", "phone", "number", "boolean", "date", "time", "choice", "choices", "reference", "photo"].includes(f.type)
      || f.min !== undefined && !Number.isFinite(f.min) || f.max !== undefined && !Number.isFinite(f.max)
      || f.min !== undefined && f.max !== undefined && f.min > f.max
      || ["choice", "choices", "reference"].includes(f.type) && (!f.options?.length || f.options.length > 100 || new Set(f.options).size !== f.options.length)
      || f.options?.some(option => typeof option !== "string" || !option || option.length > 200)) throw new TransitionError("invalid_field_definition");
  }
  for (const s of d.steps) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(s.id) || forbidden.has(s.id) || destinations(s).some(id => !steps.has(id))) throw new TransitionError("invalid_step_destination");
    if ((s.kind === "collect" || s.kind === "condition") && !fields.has(s.fieldId)) throw new TransitionError("unknown_field");
    if (s.kind === "collect" && fields.get(s.fieldId)?.source === "server") throw new TransitionError("server_field_not_collectable");
    if (s.kind === "condition" && (s.operator !== "present" && s.operator !== "equals" || s.operator === "equals" && (s.value === undefined || !validFieldValue(fields.get(s.fieldId)!, s.value)))) throw new TransitionError("invalid_condition");
    if (s.kind === "confirm" && (new Set(s.fieldIds).size !== s.fieldIds.length || s.fieldIds.some(id => !fields.has(id)) || s.requiredFieldIds?.some(id => !s.fieldIds.includes(id)))) throw new TransitionError("invalid_review_fields");
    if (s.kind === "effect" && (!s.tool || !Number.isInteger(s.toolVersion) || s.toolVersion < 1 || Object.entries(s.inputs).some(([key, id]) => !validKey(key) || !fields.has(id)))) throw new TransitionError("invalid_effect_definition");
    if (s.kind === "wait" && (!validKey(s.eventType) || !Number.isFinite(s.timeoutMs) || s.timeoutMs < 1 || s.timeoutMs > 30 * 86400000)) throw new TransitionError("invalid_wait_definition");
  }
  const visited = new Set<string>();
  const visit = (id: string) => { if (visited.has(id)) return; visited.add(id); destinations(steps.get(id)!).forEach(visit); };
  visit(d.entry);
  if (visited.size !== steps.size || !d.steps.some(s => s.kind === "end" || s.kind === "handoff")) throw new TransitionError("unreachable_definition");
  return structuredClone(d);
}
