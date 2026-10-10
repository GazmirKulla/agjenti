import { parseService } from "@/lib/services/model";
import { localInstant, validDate, validTime, uuid } from "@/lib/calendar/model";

export const actions = [
  "workflow_load",
  "workflow_read",
  "workflow_draft",
  "workflow_restore",
  "workflow_publish",
  "workflow_enable",
  "workflow_disable",
  "clarify",
  "search",
  "product_create",
  "product_update",
  "service_create",
  "service_update",
  "knowledge_create",
  "knowledge_update",
  "profile_update",
  "agent_update",
  "availability",
  "booking_create",
  "booking_update",
] as const;
export type Action = (typeof actions)[number];
export type Proposal = {
  action: Action;
  id: string | null;
  message: string;
  changes: { field: string; value: string }[];
};
export type Row = Record<string, unknown>;
export type Preview = {
  title: string;
  subject?: string;
  fields: { label: string; before: string; after: string }[];
  notice?: string;
};
export class AssistantError extends Error {}
export const fields: Record<string, string[]> = {
  workflow: ["operations", "version_id"],
  search: ["kind", "query"],
  product: ["name", "description", "sku", "price_amount", "currency"],
  service: [
    "name",
    "description",
    "category",
    "price_amount",
    "currency",
    "price_mode",
    "booking_enabled",
    "duration_minutes",
    "buffer_minutes",
    "is_active",
  ],
  knowledge: ["title", "body", "is_active"],
  profile: ["name"],
  agent: ["instructions"],
  availability: ["service_id", "date"],
  booking: [
    "service_id",
    "customer_name",
    "customer_contact",
    "date",
    "time",
    "status",
    "notes",
  ],
};
export function moduleFor(action: Action) {
  return (
    (
      {
        workflow: "workflows",
        product: "products",
        service: "services",
        knowledge: "knowledge",
        profile: "settings",
        agent: "agents",
        availability: "bookings",
        booking: "bookings",
      } as Record<string, string>
    )[action.split("_")[0]] ?? ""
  );
}
export function readProposal(input: unknown): Proposal {
  if (!input || typeof input !== "object")
    throw new AssistantError(
      "Kërkesa nuk u kuptua. Provo ta shkruash më qartë.",
    );
  const p = input as Proposal;
  if (
    !actions.includes(p.action) ||
    typeof p.message !== "string" ||
    p.message.length > 2000 ||
    (p.id !== null && !uuid(p.id)) ||
    !Array.isArray(p.changes) ||
    p.changes.length > 12
  )
    throw new AssistantError("Përgjigjja e asistentit nuk është e vlefshme.");
  const allowed = fields[p.action.split("_")[0]] ?? [];
  const seen = new Set<string>();
  for (const change of p.changes) {
    if (
      !change ||
      !allowed.includes(change.field) ||
      typeof change.value !== "string" ||
      change.value.length > (p.action === "workflow_draft" ? 24000 : 8000) ||
      seen.has(change.field)
    )
      throw new AssistantError("Asistenti propozoi një fushë të pavlefshme.");
    seen.add(change.field);
  }
  if (p.action.endsWith("_update") && p.action !== "profile_update" && !p.id)
    throw new AssistantError("Specifiko cilin element dëshiron të ndryshosh.");
  if (p.action.endsWith("_create") && p.id)
    throw new AssistantError(
      "Krijimi nuk mund të ndryshojë një element ekzistues.",
    );
  if (p.action.startsWith("workflow_") && (p.id !== null || (!["workflow_draft", "workflow_restore"].includes(p.action) && p.changes.length > 0)))
    throw new AssistantError("Kërkesë e pavlefshme për rrjedhën.");
  if (p.action === "workflow_draft" && (p.changes.length !== 1 || p.changes[0]?.field !== "operations")) throw new AssistantError("Mungojnë ndryshimet e rrjedhës.");
  if (p.action === "workflow_restore" && (p.changes.length !== 1 || p.changes[0]?.field !== "version_id" || !uuid(p.changes[0].value))) throw new AssistantError("Zgjidh një version të vlefshëm.");
  if (p.action !== "clarify" && !p.action.startsWith("workflow_") && !p.changes.length)
    throw new AssistantError("Nuk ka ndryshime për të ruajtur.");
  return p;
}
function text(value: unknown, min: number, max: number, label: string) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new AssistantError(`Kontrollo fushën “${label}”.`);
  return value.trim();
}
function bool(value: unknown) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new AssistantError("Zgjidh Po ose Jo.");
}
function money(value: unknown) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+(\.\d{1,2})?$/.test(String(value)) ||
    Number(value) > 9999999999.99
  )
    throw new AssistantError(
      "Vendos një çmim të vlefshëm, me deri në dy shifra pas presjes.",
    );
  return Number(value);
}
export function valuesFor(
  p: Proposal,
  existing: Row | null,
  timezone: string,
): Row {
  const patch: Row = Object.fromEntries(
    p.changes.map((c) => [c.field, c.value]),
  );
  const value = { ...existing, ...patch };
  const kind = p.action.split("_")[0];
  if (kind === "product") {
    const all: Row = {
      name: text(value.name, 2, 120, "Emri"),
      description: text(value.description ?? "", 0, 8000, "Përshkrimi") || null,
      sku: text(value.sku ?? "", 0, 120, "SKU") || null,
      currency: text(value.currency ?? "ALL", 3, 3, "Monedha").toUpperCase(),
      price_amount:
        value.price_amount == null ? null : money(value.price_amount),
    };
    if (!/^[A-Z]{3}$/.test(String(all.currency)))
      throw new AssistantError("Monedha është e pavlefshme.");
    return existing
      ? Object.fromEntries(Object.keys(patch).map((k) => [k, all[k]]))
      : { ...all, source: "manual", is_active: false };
  }
  if (kind === "service") {
    const f = new FormData();
    const mapping = {
      name: "name",
      description: "description",
      category: "category",
      price_amount: "price",
      currency: "currency",
      price_mode: "priceMode",
      duration_minutes: "duration",
      buffer_minutes: "buffer",
    };
    const merged = {
      description: "",
      category: "",
      currency: "EUR",
      price_mode: value.price_amount != null ? "fixed" : "request",
      duration_minutes: 30,
      buffer_minutes: 0,
      ...value,
    };
    for (const [key, field] of Object.entries(mapping))
      if (merged[key as keyof typeof merged] != null)
        f.set(field, String(merged[key as keyof typeof merged]));
    for (const [key, field] of [
      ["booking_enabled", "bookingEnabled"],
      ["is_active", "active"],
    ])
      if (bool(value[key] ?? false)) f.set(field, "on");
    if (value.hours) {
      f.set("customHours", "on");
      f.set("hours", JSON.stringify(value.hours));
    }
    try {
      const parsed = parseService(f);
      if (existing && !parsed.booking_enabled) {
        parsed.duration_minutes = Number(existing.duration_minutes ?? 30);
        parsed.buffer_minutes = Number(existing.buffer_minutes ?? 0);
        parsed.hours = existing.hours as typeof parsed.hours;
      }
      return parsed;
    } catch (e) {
      throw new AssistantError((e as Error).message);
    }
  }
  if (kind === "knowledge") {
    const all: Row = {};
    if (!existing || "title" in patch)
      all.title = text(value.title, 2, 160, "Titulli");
    if (!existing || "body" in patch)
      all.body = text(value.body, 1, 8000, "Përmbajtja");
    if (!existing || "is_active" in patch)
      all.is_active = bool(value.is_active ?? true);
    return all;
  }
  if (kind === "agent")
    return { instructions: text(value.instructions, 1, 8000, "Udhëzimet") };
  if (kind === "profile")
    return { name: text(value.name, 2, 120, "Emri i biznesit") };
  if (!uuid(value.service_id))
    throw new AssistantError("Zgjidh një shërbim konkret.");
  const date = text(value.date, 10, 10, "Data");
  if (!validDate(date)) throw new AssistantError("Data është e pavlefshme.");
  if (kind === "availability") return { service_id: value.service_id, date };
  const time = text(value.time, 5, 5, "Ora");
  if (!validTime(time)) throw new AssistantError("Ora është e pavlefshme.");
  const status = value.status ?? "pending";
  if (!["pending", "confirmed", "cancelled"].includes(String(status)))
    throw new AssistantError("Statusi i takimit është i pavlefshëm.");
  return {
    service_id: value.service_id,
    customer_name: text(value.customer_name, 2, 120, "Emri i klientit"),
    customer_contact: text(value.customer_contact, 1, 200, "Kontakti"),
    starts_at: localInstant(date, time, timezone),
    status,
    notes: text(value.notes ?? "", 0, 1000, "Shënime"),
  };
}
const labels: Record<string, string> = {
  name: "Emri",
  description: "Përshkrimi",
  sku: "SKU",
  price_amount: "Çmimi",
  currency: "Monedha",
  category: "Kategoria",
  price_mode: "Lloji i çmimit",
  booking_enabled: "Lejon rezervime",
  duration_minutes: "Kohëzgjatja (min)",
  buffer_minutes: "Pushimi (min)",
  is_active: "Aktiv",
  title: "Titulli",
  body: "Përmbajtja",
  service_id: "Shërbimi",
  customer_name: "Klienti",
  customer_contact: "Kontakti",
  starts_at: "Fillimi",
  ends_at: "Përfundimi",
  status: "Statusi",
  notes: "Shënime",
  instructions: "Udhëzimet e Agjentit",
};
const words: Record<string, string> = {
  pending: "Në pritje",
  confirmed: "Konfirmuar",
  cancelled: "Anuluar",
  fixed: "Fiks",
  from: "Duke filluar nga",
  request: "Sipas kërkesës",
};
export function previewFor(
  action: Action,
  before: Row | null,
  after: Row,
  timezone: string,
  serviceName?: string,
): Preview {
  const names: Record<string, string> = {
    product: "produktin",
    service: "shërbimin",
    knowledge: "njohuritë",
    profile: "profilin e biznesit",
    agent: "udhëzimet e Agjentit",
    booking: "takimin",
  };
  function display(key: string, value: unknown, previous = false) {
    if (value == null || value === "") return "—";
    if (typeof value === "boolean") return value ? "Po" : "Jo";
    if (key === "price_amount")
      return `${value} ${previous ? (before?.currency ?? "") : (after.currency ?? before?.currency ?? "")}`.trim();
    if (key === "service_id")
      return previous
        ? String(before?.service_name ?? serviceName ?? "Shërbimi")
        : (serviceName ?? "Shërbimi");
    if (key === "starts_at" || key === "ends_at")
      return (
        new Intl.DateTimeFormat("sq-AL", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: timezone,
        }).format(new Date(String(value))) + ` (${timezone})`
      );
    return words[String(value)] ?? String(value);
  }
  return {
    title: `${action.endsWith("_create") ? "Krijo" : "Ndrysho"} ${names[action.split("_")[0]]}`,
    subject: String(
      before?.name ??
        before?.title ??
        before?.customer_name ??
        after.name ??
        after.title ??
        after.customer_name ??
        "",
    ),
    fields: Object.entries(after)
      .filter(
        ([k, v]) =>
          labels[k] && JSON.stringify(v) !== JSON.stringify(before?.[k]),
      )
      .map(([k, v]) => ({
        label: labels[k],
        before: display(k, before?.[k], true),
        after: display(k, v),
      })),
    ...(action === "product_create" || action === "service_create"
      ? {
          notice:
            "Krijohet si joaktiv. Mund ta aktivizosh pasi të kontrollosh konfigurimin.",
        }
      : {}),
  };
}
