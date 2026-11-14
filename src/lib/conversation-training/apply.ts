import { AsyncLocalStorage } from "node:async_hooks";
import { createServiceSupabase } from "@/lib/supabase/service";
import { executeOperation, prepareOperation } from "@/lib/actions/operations/service";
import { operationActor } from "@/lib/actions/operations/access";
import { parseCommunicationPolicy, defaultCommunicationPolicy } from "@/lib/agents/communication-policy";
import { sha256, type Destination } from "./analysis-model";
import type { Edit } from "./review";

/** The style learned from conversations lives in its own block of the agent's
 * instructions; what the owner wrote by hand stays as it is. */
export const STYLE_START = "## Stili i mësuar nga bisedat";
export const STYLE_END = "## Fund i stilit të mësuar";

export function withStyleBlock(instructions: string, block: string): string {
  const section = `${STYLE_START}\n${block.trim()}\n${STYLE_END}`;
  const start = instructions.indexOf(STYLE_START), end = instructions.indexOf(STYLE_END);
  if (start >= 0 && end > start) return `${instructions.slice(0, start)}${section}${instructions.slice(end + STYLE_END.length)}`.trim();
  return `${instructions.trim()}\n\n${section}`.trim();
}

/** A uuid derived from the suggestion: the same step of the same suggestion is
 * the same operation, so a retry returns the first result instead of writing twice. */
export function operationId(suggestionId: string, step: string) {
  const h = sha256(`training|${suggestionId}|${step}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type ApplyRow = {
  id: string; destination: Destination; operation: string; target_table: string | null; target_id: string | null;
  title: string; proposed: Record<string, unknown>; edited: Edit | null;
};
type Price = { min: number; max: number | null; currency: string; approximate?: boolean; unit?: string | null; condition?: string | null };

/** The signed-in person's bearer token (mobile) for this apply; the web uses its session cookie. */
const auth = new AsyncLocalStorage<{ token?: string }>();
const tokenNow = () => auth.getStore()?.token;
async function run(businessId: string, userId: string, suggestionId: string, step: string, key: string, input: Record<string, unknown>) {
  const prepared = await prepareOperation(businessId, userId, key, input, tokenNow());
  prepared.requestId = operationId(suggestionId, step);
  return executeOperation(businessId, userId, prepared, tokenNow()) as Promise<{ message: string; path: string; id?: string }>;
}

const priceOf = (row: ApplyRow): Price | null => {
  if (row.edited && "price" in row.edited) return row.edited.price ? { ...row.edited.price, approximate: row.edited.price.max !== null } : null;
  const p = row.proposed.price as Price | null | undefined;
  return p ? { min: Number(p.min), max: p.max === null || p.max === undefined ? null : Number(p.max), currency: String(p.currency ?? "ALL"), approximate: !!p.approximate, unit: p.unit ?? null, condition: p.condition ?? null } : null;
};
const priceText = (p: Price) => `${p.min}${p.max ? `–${p.max}` : ""} ${p.currency === "ALL" ? "lekë" : p.currency}${p.condition ? ` (${p.condition})` : ""}`;
const text = (row: ApplyRow, edited: keyof Edit, proposed: string) => String((row.edited?.[edited] as string | undefined) ?? row.proposed[proposed] ?? "").trim();

async function knowledge(businessId: string, userId: string, row: ApplyRow, title: string, body: string) {
  const update = row.target_table === "knowledge_entries" && row.target_id && row.operation !== "create";
  const result = await run(businessId, userId, row.id, "knowledge", "knowledge.save", update ? { id: row.target_id, title, body } : { title, body, is_active: true });
  return { table: "knowledge_entries", id: update ? row.target_id : result.id ?? operationId(row.id, "knowledge"), message: update ? `U përditësua njohuria «${title}».` : `U shtua njohuria «${title}».` };
}

/** Writes only description and price of an existing product, with its revision: the
 * product's other fields, variants and type stay as they are. */
async function productPrice(businessId: string, userId: string, id: string, price: Price | null, description: string) {
  // The same membership check as every product operation; external catalogs are not edited here.
  const actor = await operationActor(businessId, userId, tokenNow());
  if (actor.business.catalog_source === "external") throw new Error("Ky katalog menaxhohet nga burimi i jashtëm.");
  const db = createServiceSupabase();
  const { data: current } = await db.from("products").select("id,description,updated_at,archived_at").eq("business_id", businessId).eq("id", id).maybeSingle();
  if (!current || current.archived_at) throw new Error("Produkti nuk gjendet më ose është arkivuar.");
  const patch: Record<string, unknown> = {};
  if (description && !String(current.description ?? "").trim()) patch.description = description;
  if (price) Object.assign(patch, { price_amount: price.min, price_max: price.max, price_mode: price.max ? "range" : price.approximate ? "from" : "fixed", currency: price.currency, ...(price.unit ? { price_unit: price.unit.slice(0, 20) } : {}) });
  if (!Object.keys(patch).length) return;
  const { data, error } = await db.from("products").update({ ...patch, updated_at: new Date(Math.max(Date.now(), Date.parse(current.updated_at) + 1)).toISOString() })
    .eq("business_id", businessId).eq("id", id).eq("updated_at", current.updated_at).select("id").maybeSingle();
  if (error || !data) throw new Error("Produkti ndryshoi ndërkohë. Rishqyrtoje.");
}

async function product(businessId: string, userId: string, row: ApplyRow) {
  const price = priceOf(row), name = text(row, "name", "name"), description = text(row, "description", "description");
  if (row.operation === "create") {
    // New products are drafts: activating them needs the product type the catalog requires.
    await run(businessId, userId, row.id, "product", "product.create", { name, description, price_amount: price?.min ?? null, currency: price?.currency ?? "ALL", is_active: false });
    const { data: created } = await createServiceSupabase().from("products").select("id").eq("business_id", businessId).eq("name", name).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (created && price && (price.max || price.approximate)) await productPrice(businessId, userId, created.id, price, "");
    return { table: "products", id: created?.id ?? null, message: `U shtua produkti «${name}» si draft${price ? `, ${priceText(price)}` : ""}. Aktivizoje te Produktet.` };
  }
  if (!row.target_id || row.target_table !== "products") throw new Error("Produkti që do përditësohej nuk u gjet.");
  await productPrice(businessId, userId, row.target_id, price, description);
  return { table: "products", id: row.target_id, message: `U përditësua produkti «${name}»${price ? `: ${priceText(price)}` : ""}.` };
}

/** Services keep a fixed price or a starting price; a range is written as "nga" plus its text. */
async function service(businessId: string, userId: string, row: ApplyRow) {
  const price = priceOf(row), name = text(row, "name", "name");
  let description = text(row, "description", "description");
  if (price?.max) description = [description, `Çmimi: ${priceText(price)}.`].filter(Boolean).join("\n");
  const priceFields = price ? { price_amount: price.min, currency: price.currency, price_mode: price.max || price.approximate ? "from" : "fixed" } : {};
  if (row.operation === "create") {
    await run(businessId, userId, row.id, "service", "service.save", { name, description, ...(price ? priceFields : { price_mode: "request", currency: "ALL" }), is_active: true });
    const { data: created } = await createServiceSupabase().from("booking_services").select("id").eq("business_id", businessId).eq("name", name).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return { table: "booking_services", id: created?.id ?? null, message: `U shtua shërbimi «${name}»${price ? `, ${priceText(price)}` : ""}.` };
  }
  if (!row.target_id || row.target_table !== "booking_services") throw new Error("Shërbimi që do përditësohej nuk u gjet.");
  const { data: current } = await createServiceSupabase().from("booking_services").select("description").eq("business_id", businessId).eq("id", row.target_id).maybeSingle();
  const keepDescription = String(current?.description ?? "").trim();
  // An existing description is kept; a range is added to it as text.
  const nextDescription = price?.max ? (keepDescription ? `${keepDescription}\nÇmimi: ${priceText(price)}.` : description) : keepDescription ? null : description || null;
  await run(businessId, userId, row.id, "service", "service.save", { id: row.target_id, ...priceFields, ...(nextDescription ? { description: nextDescription } : {}) });
  return { table: "booking_services", id: row.target_id, message: `U përditësua shërbimi «${name}»${price ? `: ${priceText(price)}` : ""}.` };
}

async function style(businessId: string, userId: string, row: ApplyRow) {
  const { data: agent } = await createServiceSupabase().from("ai_agents").select("id,instructions,communication,configuration_draft")
    .eq("business_id", businessId).order("is_active", { ascending: false }).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!agent) throw new Error("Krijo fillimisht Agjentin, pastaj apliko stilin.");
  if (agent.configuration_draft) throw new Error("Ke një draft të papublikuar te udhëzimet e Agjentit. Publikoje ose hidhe përpara stilit.");
  const block = text(row, "instructions", "instructions");
  const policy = row.proposed.policy as Record<string, string> | undefined;
  let communication: ReturnType<typeof parseCommunicationPolicy>;
  try { communication = parseCommunicationPolicy(agent.communication); } catch { communication = { ...defaultCommunicationPolicy }; }
  const next = { ...communication, ...(policy ? { tone: policy.tone, length: policy.length, emoji: policy.emoji, questions: policy.questions } : {}) };
  const instructions = withStyleBlock(agent.instructions ?? "", block);
  if (instructions.length > 8000) throw new Error("Udhëzimet do kalonin 8000 shkronja. Shkurtoji përpara stilit.");
  // The same versioned path as the editor: a draft, then its publication (the old version can be restored).
  await run(businessId, userId, row.id, "draft", "agent.communication", { id: agent.id, mode: "draft", instructions, communication: next });
  const published = await run(businessId, userId, row.id, "publish", "agent.communication", { id: agent.id, mode: "publish" });
  return { table: "ai_agents", id: agent.id, message: `Stili u shtua te udhëzimet e Agjentit. ${published.message}` };
}

async function example(businessId: string, userId: string, row: ApplyRow) {
  const customerMessage = text(row, "customer_message", "customer_message"), desiredResponse = text(row, "desired_response", "desired_response");
  const situation = String(row.proposed.situation ?? "").trim();
  await run(businessId, userId, row.id, "example", "training.save", {
    kind: "example", instruction: `Shembull real nga bisedat${situation ? `: ${situation}` : ""}. Ndiq stilin, jo faktet e tij.`.slice(0, 1500), customerMessage, desiredResponse,
  });
  return { table: "agent_training_memories", id: null, message: `U shtua shembulli «${situation || customerMessage.slice(0, 60)}».` };
}

/** Applies one approved suggestion to its own section, through the platform's existing writers. */
export async function applySuggestion(businessId: string, userId: string, row: ApplyRow, accessToken?: string) {
  return auth.run({ token: accessToken }, () => applyTo(businessId, userId, row));
}
async function applyTo(businessId: string, userId: string, row: ApplyRow) {
  switch (row.destination) {
    case "style": return style(businessId, userId, row);
    case "example": return example(businessId, userId, row);
    case "product": return product(businessId, userId, row);
    case "service": return service(businessId, userId, row);
    case "knowledge": return knowledge(businessId, userId, row, text(row, "title", "title"), text(row, "body", "body"));
    case "gap": return knowledge(businessId, userId, { ...row, operation: "create" }, text(row, "title", "question"), text(row, "body", "body"));
    case "profile": {
      // Calendar hours drive bookings: they are changed only in the calendar, by the owner.
      const toKnowledge = row.target_table === "knowledge_entries" ? row : { ...row, operation: "create", target_id: null };
      const done = await knowledge(businessId, userId, toKnowledge, String(row.proposed.title ?? row.title), text(row, "body", "body"));
      return row.target_table === "business_calendar_settings" ? { ...done, message: `${done.message} Orari i kalendarit nuk u ndryshua: ndryshoje te Kalendari nëse duhet.` } : done;
    }
    case "workflow": {
      const steps = Array.isArray(row.proposed.steps) ? (row.proposed.steps as string[]).map((s, i) => `${i + 1}. ${s}`).join("\n") : "";
      const done = await knowledge(businessId, userId, { ...row, operation: "create" }, text(row, "title", "name") || row.title, row.edited?.body ?? steps);
      return { ...done, message: `${done.message} Agjenti e përdor si udhëzues; për hapa automatikë krijo një proces te Proceset.` };
    }
  }
}
