import { createServiceSupabase } from "@/lib/supabase/service";
import { runtimeModules } from "@/lib/capabilities/enforcement";
import { isIsolatedExecution } from "@/lib/runtime/execution-context";
import { validateVisualGraph } from "@/lib/workflows/visual/model";
import type { VisualEdge, VisualFlow, VisualGraphV2, VisualNode, VisualVersion } from "@/lib/workflows/visual/types";
import { parseCommunicationPolicy } from "@/lib/agents/communication-policy";
import { digest } from "./definition";

/**
 * The automatic process: what the agent can do for a business that has no workflow of its own, built by
 * the server from the business's modules and settings. The owner never draws or publishes it. It is an
 * ordinary immutable graph version (visual_workflow_versions, marked automatic), compiled by the same
 * engine and checked by the same order and booking functions as a published workflow.
 *
 * Each capability is offered only when the business can actually deliver it; what decides that is data
 * and settings, never the wording of a message.
 */
export type AutomaticCapability = "orders" | "orderStatus" | "bookings" | "handoff";
export type AutomaticReadiness = { capability: AutomaticCapability; ready: boolean; reason: string };

type Facts = {
  /** The owner's wording for a handoff, from the active agent's published communication settings. */
  handoffMessage?: string;
  /** False when the business only collects confirmed orders for staff (business_automation_policies.local_orders). */
  localOrders?: boolean;
  modules: string[] | null;
  orderableProducts: boolean;
  bookingCalendar: boolean;
  bookableServices: boolean;
};

const allowed = (modules: string[] | null, ...ids: string[]) => !modules || ids.every(id => modules.includes(id));

/** Pure rule: which capabilities are ready, and why not when they are not. */
export function automaticReadiness(facts: Facts): AutomaticReadiness[] {
  const { modules } = facts;
  // Every process runs through the workflow engine, which the business's package must allow.
  const engine = allowed(modules, "workflows");
  const blocked = (reason: string) => engine ? reason : "Paketa e biznesit nuk përfshin proceset e Agjentit.";
  return [
    { capability: "orders",
      ...(!engine || !allowed(modules, "products", "orders") ? { ready: false, reason: blocked("Ndiz Produktet dhe Porositë.") }
        : !facts.orderableProducts ? { ready: false, reason: "Shto të paktën një produkt aktiv me çmim të caktuar, ose me variante me çmim, që nuk është vetëm për informim." }
        : facts.localOrders === false ? { ready: true, reason: "Agjenti mbledh kërkesën dhe konfirmimin e klientit; stafi e regjistron porosinë nga biseda." }
        : { ready: true, reason: "Agjenti merr porosi për produktet aktive." }) },
    { capability: "orderStatus",
      ...(!engine || !allowed(modules, "orders") ? { ready: false, reason: blocked("Ndiz Porositë.") }
        : { ready: true, reason: "Agjenti i tregon klientit statusin e porosive të tij." }) },
    { capability: "bookings",
      ...(!engine || !allowed(modules, "bookings", "services") ? { ready: false, reason: blocked("Ndiz Shërbimet dhe Rezervimet.") }
        : !facts.bookingCalendar ? { ready: false, reason: "Te Kalendari, lejo Agjentin të rezervojë vetë." }
        : !facts.bookableServices ? { ready: false, reason: "Shto të paktën një shërbim aktiv që pranon rezervime." }
        : { ready: true, reason: "Agjenti rezervon sipas orarit të kalendarit." }) },
    { capability: "handoff",
      ...(!engine || !allowed(modules, "inbox") ? { ready: false, reason: blocked("Ndiz Bisedat.") }
        : { ready: true, reason: "Agjenti ia kalon bisedën stafit kur klienti kërkon një person." }) },
  ];
}

const node = (id: string, kind: VisualNode["kind"], label: string, x: number, y: number, config: VisualNode["config"] = {}): VisualNode =>
  ({ id, kind, label, position: { x, y }, config });
const edge = (source: string, target: string): VisualEdge => ({ id: `${source}_${target}`, source, target, port: "next" });

/**
 * The graph for the ready capabilities, or null when none is ready. Flow purposes tell the agent's
 * interpretation when each process applies; the decision stays with the model, with evidence from the message.
 */
export const defaultHandoffMessage = "Ia kalova kërkesën tënde një personi nga ekipi; do të të shkruajë së shpejti.";
export function automaticGraph(readiness: AutomaticReadiness[], { handoffMessage }: { handoffMessage?: string } = {}): VisualGraphV2 | null {
  const ready = new Set(readiness.filter(r => r.ready).map(r => r.capability));
  if (!ready.size) return null;
  const nodes: VisualNode[] = [node("start", "start", "Mesazh i ri", 20, 60), node("start_end", "end", "Përfundim", 300, 60)];
  const edges: VisualEdge[] = [edge("start", "start_end")];
  const flows: VisualFlow[] = [];
  if (ready.has("orders")) {
    nodes.push(node("auto_order_product", "product", "Produkti", 20, 220), node("auto_order_end", "end", "Porosia", 300, 220));
    edges.push(edge("auto_order_product", "auto_order_end"));
    flows.push({ id: "auto_order", label: "Porosi", kind: "order", offerPolicy: "when_relevant", entryNodeId: "auto_order_product",
      nodeIds: ["auto_order_product", "auto_order_end"],
      purpose: "The customer wants to buy or order a product from the business's catalog." });
  }
  if (ready.has("orderStatus")) {
    nodes.push(node("auto_status_check", "order_status", "Statusi i porosisë", 20, 380), node("auto_status_end", "end", "Statusi u tregua", 300, 380));
    edges.push(edge("auto_status_check", "auto_status_end"));
    flows.push({ id: "auto_order_status", label: "Statusi i porosisë", kind: "information", offerPolicy: "on_request", entryNodeId: "auto_status_check",
      nodeIds: ["auto_status_check", "auto_status_end"],
      purpose: "The customer asks about the status or delivery of an order they already placed with this business." });
  }
  if (ready.has("bookings")) {
    nodes.push(node("auto_booking", "booking", "Rezervimi", 20, 540), node("auto_booking_end", "end", "Rezervimi", 300, 540));
    edges.push(edge("auto_booking", "auto_booking_end"));
    flows.push({ id: "auto_booking", label: "Rezervim", kind: "booking", offerPolicy: "when_relevant", entryNodeId: "auto_booking",
      nodeIds: ["auto_booking", "auto_booking_end"],
      purpose: "The customer wants to book an appointment or a time for one of the business's services." });
  }
  if (ready.has("handoff")) {
    nodes.push(node("auto_handoff", "handoff", "Stafi", 20, 700, { prompt: handoffMessage || defaultHandoffMessage }));
    flows.push({ id: "auto_handoff", label: "Kalim te stafi", kind: "support", offerPolicy: "on_request", entryNodeId: "auto_handoff",
      nodeIds: ["auto_handoff"],
      purpose: "The customer asks to talk to a person from the business, or the request needs the business's staff." });
  }
  return { version: 2, name: "Agjenti automatik", nodes, edges, flows };
}

/** A stable id from the business and the graph: the same settings always give the same version. */
export function automaticVersionId(businessId: string, graph: VisualGraphV2) {
  const h = digest({ automaticProcess: 1, businessId, graph });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The facts the readiness rule needs, read for this business only. */
export async function readAutomaticFacts(businessId: string): Promise<Facts> {
  const db = createServiceSupabase();
  const [modules, fixed, variants, calendar, services, agent, policy] = await Promise.all([
    runtimeModules(businessId),
    db.from("products").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("is_active", true)
      .is("archived_at", null).neq("availability", "sold").eq("price_mode", "fixed").not("price_amount", "is", null).not("currency", "is", null).eq("agent_orders", true),
    db.from("product_variants").select("id,products!inner(id)", { count: "exact", head: true }).eq("business_id", businessId).eq("is_active", true)
      .not("price_amount", "is", null).eq("products.is_active", true).is("products.archived_at", null).eq("products.agent_orders", true),
    db.from("business_calendar_settings").select("agent_booking_enabled").eq("business_id", businessId).maybeSingle(),
    db.from("booking_services").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("is_active", true).eq("booking_enabled", true),
    db.from("ai_agents").select("communication").eq("business_id", businessId).eq("is_active", true).maybeSingle(),
    db.from("business_automation_policies").select("local_orders").eq("business_id", businessId).maybeSingle(),
  ]);
  if (fixed.error || variants.error || calendar.error || services.error || agent.error) throw new Error("automatic_process_unverified");
  // A stored policy that no longer parses keeps the default wording; it never blocks the process.
  let handoffMessage: string | undefined;
  try { handoffMessage = agent.data?.communication ? parseCommunicationPolicy(agent.data.communication).handoffMessage : undefined; } catch { handoffMessage = undefined; }
  // Only the wording depends on it; the server decides at submission whether an order is registered.
  return { ...(handoffMessage ? { handoffMessage } : {}), ...(policy.error ? {} : { localOrders: policy.data?.local_orders === true }), modules, orderableProducts: (fixed.count ?? 0) > 0 || (variants.count ?? 0) > 0,
    bookingCalendar: calendar.data?.agent_booking_enabled === true, bookableServices: (services.count ?? 0) > 0 };
}

/** Whether the owner has a workflow of their own (published, on or off): then that one decides, never the automatic one. */
async function hasOwnWorkflow(businessId: string) {
  const { data, error } = await createServiceSupabase().from("visual_workflows").select("published_version_id").eq("business_id", businessId).maybeSingle();
  if (error) return !["42P01", "PGRST205"].includes(error.code ?? "");
  return Boolean(data?.published_version_id);
}

/** For a gate: whether the owner has published a process of their own. Throws when it cannot be verified. */
export async function ownProcessPublished(businessId: string): Promise<boolean> {
  const { data, error } = await createServiceSupabase().from("visual_workflows").select("published_version_id").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error("own_process_unverified");
  return Boolean(data?.published_version_id);
}

/**
 * The automatic version for a business without its own workflow, stored once so conversations can be
 * pinned to it and the database can verify it. Null when the business has its own workflow, when nothing
 * is ready, or when it cannot be verified: the agent then only informs, as without a workflow.
 */
export async function loadAutomaticVersion(businessId: string): Promise<VisualVersion | null> {
  try {
    if (await hasOwnWorkflow(businessId)) return null;
    const facts = await readAutomaticFacts(businessId);
    const graph = automaticGraph(automaticReadiness(facts), facts);
    if (!graph || !validateVisualGraph(graph).graph) return null;
    const id = automaticVersionId(businessId, graph);
    // A test conversation never writes; it uses the same id the live version would have.
    if (!isIsolatedExecution()) {
      const { data, error } = await createServiceSupabase().rpc("ensure_automatic_process_version", { p_business: businessId, p_id: id, p_graph: graph });
      if (error || data !== id) return null;
    }
    return { id, businessId, graph, createdAt: "", collectionPolicy: null };
  } catch {
    return null;
  }
}

/**
 * Whether the agent can carry out at least one process for this business: its own published workflow, or
 * an automatic capability that is ready. Null when it cannot be verified.
 */
export async function agentProcessReady(businessId: string): Promise<boolean | null> {
  try {
    if (await hasOwnWorkflow(businessId)) return true;
    return automaticReadiness(await readAutomaticFacts(businessId)).some(r => r.ready);
  } catch {
    return null;
  }
}

/** What the owner and the product pages are told: the automatic process and what it can do now. */
export async function automaticStatus(businessId: string): Promise<{ readiness: AutomaticReadiness[]; active: boolean } | null> {
  try {
    if (await hasOwnWorkflow(businessId)) return null;
    const readiness = automaticReadiness(await readAutomaticFacts(businessId));
    return { readiness, active: readiness.some(r => r.ready) };
  } catch {
    return null;
  }
}
