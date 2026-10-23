import type { SupabaseClient } from "@supabase/supabase-js";
import { foldText } from "@/lib/workflows/engine";
import { matchingCatalogNames } from "@/lib/products/match-name";
import type { ReferenceProduct } from "@/lib/products/entity-bridge";
import { rankKnowledge } from "@/lib/catalogs/source-ranking";

export type ReadStatus = "complete" | "partial" | "no_match" | "unavailable" | "unsupported" | "unverified";
/** Evidence from a server-authorized read, never an execution permission or a cache. */
export type GroundedRead<T> = {
  source: "products" | "booking_services" | "knowledge_entries" | "catalog_sections";
  businessId: string;
  status: ReadStatus;
  reason?: string;
  retrievedAt: string;
  total: number | null;
  records: T[];
};
export type GroundedProduct = ReferenceProduct & { description?: string | null; product_type_id?: string | null; workflow_id?: string | null };
export type GroundedService = ReferenceProduct & { description?: string; duration_minutes?: number; price_mode?: "fixed" | "from" | "request"; booking_enabled?: boolean };
export type GroundedKnowledge = { id: string; title: string; body: string; intent_key?: string | null; updated_at?: string };
export type BusinessGrounding = {
  products: GroundedRead<GroundedProduct>;
  services: GroundedRead<GroundedService>;
  knowledge: GroundedRead<GroundedKnowledge>;
  documents: GroundedRead<{ id: string; title: string; url: string; excerpt: string }>;
  /** Service configuration is not slot availability, request readiness or permission to book. */
  bookingModuleEnabled: boolean;
  availability: "unverified";
  inventory: "unsupported";
};
export function readResult<T>(source: GroundedRead<T>["source"], businessId: string,
  result: { data: T[] | null; error?: unknown; count?: number | null }, enabled = true): GroundedRead<T> {
  const records = enabled && !result.error ? result.data ?? [] : [];
  const total = enabled && !result.error && typeof result.count === "number" ? result.count : null;
  const status: ReadStatus = !enabled ? "unavailable" : result.error ? "unavailable"
    : total === 0 ? "no_match" : total === records.length ? "complete" : "partial";
  return { source, businessId, status, total, records, retrievedAt: new Date().toISOString(),
    ...(!enabled ? { reason: "module_disabled" } : result.error ? { reason: "read_failed" }
      : status === "partial" ? { reason: total === null ? "completeness_unverified" : "row_limit" } : {}) };
}

/** Adapter over the information pipeline's existing reads. Caller supplies its
 * trusted tenant and current runtimeModules result; never expose as a client RPC.
 * Count and bounded rows come from the same PostgREST statement/snapshot. */
export async function readBusinessGrounding(db: SupabaseClient, businessId: string, modules: string[] | null,
  entity?: { kind: "product" | "service"; id: string }): Promise<BusinessGrounding> {
  const enabled = (module: string) => !modules || modules.includes(module);
  const absent = { data: [], error: null, count: 0 };
  const [p, s, k] = await Promise.all([
    enabled("products") ? db.from("products").select("id,name,sku,description,product_type_id,workflow_id,price_amount,currency", { count: "exact" })
      .eq("business_id", businessId).eq("is_active", true).order("id").limit(1000) : absent,
    enabled("services") ? db.from("booking_services").select("id,name,description,price_amount,currency,price_mode,duration_minutes,booking_enabled", { count: "exact" })
      .eq("business_id", businessId).eq("is_active", true).order("id").limit(500) : absent,
    enabled("knowledge") ? db.from("knowledge_entries").select("id,title,body,intent_key,updated_at", { count: "exact" })
      .eq("business_id", businessId).eq("is_active", true).order("sort_order").limit(1000) : absent,
  ]);
  const products = readResult<GroundedProduct>("products", businessId, p, enabled("products"));
  const services = readResult<GroundedService>("booking_services", businessId, s, enabled("services"));
  // A coordinator-resolved relative reference can lie outside the bounded read.
  // Fetch its current facts using the SAME active/tenant restrictions, not its
  // historical presented name/price. This never makes a partial read complete.
  if (entity) {
    const result = entity.kind === "product" ? products : services;
    if (result.status !== "unavailable" && !result.records.some(row => row.id === entity.id)) {
      const extra = await db.from(entity.kind === "product" ? "products" : "booking_services")
        .select(entity.kind === "product" ? "id,name,sku,description,product_type_id,workflow_id,price_amount,currency" : "id,name,description,price_amount,currency,price_mode,duration_minutes,booking_enabled")
        .eq("business_id", businessId).eq("is_active", true).eq("id", entity.id).maybeSingle();
      if (extra.error) { result.status = "unavailable"; result.reason = "reference_read_failed"; result.records = []; result.total = null; }
      else if (extra.data && "id" in extra.data && extra.data.id === entity.id) { result.records.push(extra.data as GroundedProduct & GroundedService); result.status = "partial"; result.reason = "selected_entity_outside_snapshot"; }
    }
  }
  return { products, services,
    knowledge: readResult("knowledge_entries", businessId, k, enabled("knowledge")),
    documents: { source: "catalog_sections", businessId, status: "unverified", reason: "not_queried", retrievedAt: new Date().toISOString(), records: [], total: null },
    bookingModuleEnabled: enabled("bookings"), availability: "unverified", inventory: "unsupported" };
}

/** Bounded per-turn projection. No facts are written to conversation state. */
export function projectBusinessGrounding(read: BusinessGrounding, message: string, entity?: { kind: "product" | "service"; id: string }) {
  const subset = <T extends ReferenceProduct & { description?: string | null }>(result: GroundedRead<T>, kind: "product" | "service"): GroundedRead<T> => {
    const named = matchingCatalogNames(result.records, message);
    const priority = result.records.filter(row => entity?.kind === kind && entity.id === row.id);
    const records = [...new Map([...priority, ...named, ...result.records].map(row => [row.id, row])).values()]
      .slice(0, 12).map(row => ({ ...row, description: row.description?.slice(0, 600),
        ...((row.description?.length ?? 0) > 600 ? { descriptionTruncated: true } : {}) }));
    return { ...result, records, ...(records.length < result.records.length ? { status: "partial" as const, reason: "context_limit" } : {}) };
  };
  // Service mirrors are not an independent authority and can be edited as knowledge.
  // Use booking_services for current price/duration/booking configuration instead.
  const ranked = rankKnowledge(read.knowledge.records.filter(row => row.intent_key !== "service"), message);
  const records = ranked.slice(0, 12).map(({ entry }) => ({ ...entry, body: entry.body.slice(0, 1500), ...(entry.body.length > 1500 ? { bodyTruncated: true } : {}) }));
  const knowledge = { ...read.knowledge, records };
  if (!["unavailable", "unverified"].includes(knowledge.status)) {
    knowledge.status = !records.length ? read.knowledge.status === "partial" ? "partial" : "no_match" : "partial";
    knowledge.reason = !records.length ? "no_relevant_evidence_in_read" : "relevance_subset_not_complete_policy";
  }
  return { ...read, products: subset(read.products, "product"), services: subset(read.services, "service"), knowledge };
}

type ExactReply = { reply: string; presentedProducts?: ReferenceProduct[]; presentedServices?: ReferenceProduct[] };
const priced = (p: ReferenceProduct) => typeof p.price_amount === "number" && Number.isFinite(p.price_amount) && p.price_amount >= 0 && Boolean(p.currency?.trim());
function price(p: ReferenceProduct & { price_mode?: GroundedService["price_mode"] }) {
  if (p.price_mode === "request" || !priced(p)) return "çmimi nuk është i përcaktuar; kontakto biznesin";
  return `${p.price_mode === "from" ? "nga " : ""}${p.price_amount} ${p.currency}`;
}
/** Small, fixed factual operations, not a router or natural-language SQL engine.
 * Invoke only AFTER the coordinator selected an informational execution path. */
export function exactBusinessAnswer(read: BusinessGrounding, message: string, entity?: { kind: "product" | "service"; id: string }): ExactReply | undefined {
  const text = foldText(message).trim().replace(/[?!.]+$/, "");
  const count = /^(?:sa produkte (?:keni|ka|jane)|how many products (?:do you have|are there))$/.test(text);
  const extreme = /^(?:(?:cili eshte )?(?:produkti )?me i (lire|shtrenjte)|(?:the )?(cheapest|most expensive) product)$/.exec(text);
  const priceQuery = /^(?:sa kushton|sa kushtojne|what is the price of|how much is)\s+/.test(text);
  const servicesQuery = /^(?:cfare sherbimesh keni|cilat sherbime ofroni|list services|what services do you offer)$/.test(text);
  const duration = /^(?:sa zgjat|how long is)\s+/.test(text);
  const stock = /^(?:a (?:eshte|ka|keni).*(?:ne gjendje|ne stok)|check (?:the )?(?:stock|inventory))$/.test(text);
  if (stock) return { reply: "Nuk kam burim të verifikuar për stokun. Prania në katalog nuk konfirmon disponueshmërinë; kontakto biznesin." };
  if (!count && !extreme && !priceQuery && !servicesQuery && !duration) return;
  const serviceMatches = matchingCatalogNames(read.services.records, message);
  const productMatches = matchingCatalogNames(read.products.records, message);
  const kind = !count && !extreme && (servicesQuery || duration || entity?.kind === "service" || serviceMatches.length && !productMatches.length) ? "service" : "product";
  const result = kind === "product" ? read.products : read.services;
  if (result.status === "unavailable") return { reply: result.reason === "module_disabled"
    ? "Ky informacion është çaktivizuar për biznesin. Kontakto stafin."
    : "Nuk munda t’i verifikoj të dhënat tani. Kjo nuk do të thotë se katalogu është bosh; provo përsëri." };
  if (count) return { reply: read.products.total === null ? "Nuk munda të verifikoj numrin e plotë të produkteve."
    : `Në katalog janë ${read.products.total} produkte aktive. Ky numër nuk tregon stokun ose mundësinë e porositjes.` };
  if (extreme) {
    if (read.products.status === "no_match") return { reply: "Nuk gjeta produkte aktive në katalog." };
    if (read.products.status !== "complete") return { reply: "Kam vetëm një pjesë të katalogut; nuk mund të përcaktoj produktin më të lirë ose më të shtrenjtë në të gjithë katalogun." };
    const rows = read.products.records;
    if (!rows.length) return { reply: "Nuk gjeta produkte aktive në katalog." };
    if (rows.some(p => !priced(p)) || new Set(rows.map(p => p.currency)).size !== 1)
      return { reply: "Nuk mund t’i krahasoj të gjitha çmimet: disa mungojnë ose monedhat ndryshojnë. Për cilin produkt ose monedhë po pyet?" };
    const value = (extreme[1] === "lire" || extreme[2] === "cheapest" ? Math.min : Math.max)(...rows.map(p => p.price_amount!));
    const matches = rows.filter(p => p.price_amount === value);
    return { reply: `${matches.length > 1 ? "Ka produkte me çmim të barabartë" : "Sipas çmimeve aktuale të katalogut"}:\n${matches.slice(0, 10).map(p => `${p.name} — ${price(p)}`).join("\n")}${matches.length > 10 ? "\nLista e barazimeve është e pjesshme." : ""}`,
      presentedProducts: matches.slice(0, 10) };
  }
  if (servicesQuery) {
    const rows = read.services.records.slice(0, 10);
    return rows.length ? { reply: `${read.services.status === "complete" && rows.length === read.services.records.length ? "Shërbimet aktive" : "Disa shërbime aktive (listë e pjesshme)"}:\n${rows.map(s => `${s.name} — ${price(s)}${s.duration_minutes ? `; ${s.duration_minutes} min` : ""}`).join("\n")}\nPrania e shërbimit nuk konfirmon termine të lira apo autorizim rezervimi.`, presentedServices: rows }
      : { reply: read.services.status === "no_match" ? "Nuk gjeta shërbime aktive." : "Nuk munda të verifikoj listën e shërbimeve." };
  }
  const matches = entity ? result.records.filter(p => p.id === entity.id) : kind === "product" ? productMatches : serviceMatches;
  if ((!entity && result.status !== "complete") || productMatches.length && serviceMatches.length && !entity || matches.length !== 1)
    return { reply: "Nuk e identifikova me siguri një produkt ose shërbim të vetëm. Cilin emër të plotë ke parasysh?" };
  const selected = matches[0] as GroundedService;
  return { reply: duration ? `${selected.name}: ${selected.duration_minutes ? `${selected.duration_minutes} min. Kjo nuk konfirmon termine të lira.` : "kohëzgjatja nuk është verifikuar."}`
    : `${selected.name}: ${price(selected)}.`, ...(kind === "product" ? { presentedProducts: [selected] } : { presentedServices: [selected] }) };
}
