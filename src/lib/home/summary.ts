import { createServiceSupabase } from "@/lib/supabase/service";
import { leadSettings } from "@/lib/leads/model";
import { loadBusinessReport } from "@/lib/reports/service";
import { moduleDependencies, moduleRegistry } from "@/lib/dashboard/modules/registry";
import type { DashboardProfile, ModuleId } from "@/lib/dashboard/modules/types";
import { homeModuleSplit } from "./modules";
import { added, homeRange, money, periodDays, type HomeCard, type HomeMessages, type HomeModuleLink, type HomePeriod } from "./model";

type Count = { count: number | null; error: unknown };
const n = (result: Count) => (result.error || result.count === null ? 0 : result.count);

/** Kreu: incoming messages, a card for each module that suits the business or
 * already holds its records (its count, what was added in the period and one
 * thing to act on, or the first step while it is empty), and every other
 * module as a link. Reads only; nothing is changed. */
export async function loadHomeModules(
  business: { id: string; slug: string },
  profile: Pick<DashboardProfile, "source" | "signals" | "enabledModules" | "hiddenModules">,
  period: HomePeriod,
  now = new Date(),
) {
  const db = createServiceSupabase();
  const id = business.id;
  const base = `/b/${encodeURIComponent(business.slug)}`;
  const count = (table: string) => db.from(table).select("id", { count: "exact", head: true }).eq("business_id", id);
  const [{ data: settings }, { data: usedModules }, leadsRecorded] = await Promise.all([
    db.from("businesses").select("timezone,lead_settings").eq("id", id).maybeSingle(),
    db.rpc("business_used_modules", { p_business: id }),
    // business_used_modules does not cover leads yet.
    count("leads").limit(1),
  ]);
  const used = new Set<string>(Array.isArray(usedModules) ? usedModules : []);
  if (n(leadsRecorded)) used.add("leads");
  const split = homeModuleSplit(profile, used);
  const range = homeRange(period, settings?.timezone || "Europe/Tirane", now);
  const on = (module: ModuleId) => split.highlighted.includes(module);
  const since = (table: string) => count(table).gte("created_at", range.from);

  const messages = async (): Promise<HomeMessages> => {
    const days = Math.max(7, periodDays(period));
    const [inbound, replies, handoffs, report] = await Promise.all([
      since("messages").eq("direction", "inbound").eq("source", "customer"),
      since("messages").eq("direction", "outbound").eq("source", "agent"),
      // Conversations staff took over and that are still with them.
      db.from("conversation_states").select("conversation_id,conversations!inner(id)", { count: "exact", head: true })
        .eq("business_id", id).eq("conversations.business_id", id).eq("conversations.status", "paused")
        .or("collected->>staffHandoff.eq.true,and(collected->visual->>status.eq.handoff,or(collected->visual->>advisory.is.null,collected->visual->>advisory.eq.false))"),
      loadBusinessReport(id, days).catch(() => null),
    ]);
    return { inbound: n(inbound), agentReplies: n(replies), handoffs: n(handoffs),
      days: (report?.days ?? []).slice(-days).map((day) => ({ day: day.day, value: day.inbound })) };
  };

  const cards: Promise<HomeCard | null>[] = [];
  if (on("products")) cards.push((async () => {
    const live = () => count("products").is("archived_at", null).eq("item_kind", "product");
    const [total, fresh, priceless] = await Promise.all([live(), live().gte("created_at", range.from), live().is("price_amount", null)]);
    return { id: "products", label: "Produktet", icon: moduleRegistry.products.icon, href: `${base}/products`, value: n(total), caption: "produkte",
      detail: added(n(fresh), "të reja"), detailTone: "up",
      attention: n(priceless) ? { text: `${n(priceless)} pa çmim`, href: `${base}/products`, tone: "warning" } : undefined,
      empty: n(total) ? undefined : { text: "Agjenti u përgjigjet klientëve me produktet që shton këtu.",
        actions: [{ label: "Shto produkt", href: `${base}/products/new` }, { label: "Importo CSV", href: `${base}/products/new?method=csv` }] } };
  })());
  if (on("services")) cards.push((async () => {
    const [total, fresh, priceless] = await Promise.all([
      count("booking_services").eq("is_active", true),
      count("booking_services").eq("is_active", true).gte("created_at", range.from),
      count("booking_services").eq("is_active", true).is("price_amount", null).neq("price_mode", "request"),
    ]);
    return { id: "services", label: "Shërbimet", icon: moduleRegistry.services.icon, href: `${base}/services`, value: n(total), caption: "shërbime aktive",
      detail: added(n(fresh), "të reja"), detailTone: "up",
      attention: n(priceless) ? { text: `${n(priceless)} pa çmim`, href: `${base}/services`, tone: "warning" } : undefined,
      empty: n(total) ? undefined : { text: "Shto shërbimet që ofron, me çmimin dhe kohëzgjatjen.",
        actions: [{ label: "Shto shërbim", href: `${base}/services` }] } };
  })());
  if (on("orders")) cards.push((async () => {
    const [{ data: rows }, problems] = await Promise.all([
      db.from("orders").select("total_amount,currency").eq("business_id", id).gte("created_at", range.from).neq("status", "draft").limit(2000),
      count("orders").in("status", ["failed", "pending_reconciliation"]),
    ]);
    const value = money(rows ?? []);
    return { id: "orders", label: "Porositë", icon: moduleRegistry.orders.icon, href: `${base}/orders`, value: rows?.length ?? 0, caption: "porosi në periudhë",
      detail: value ? `vlera ${value}` : undefined,
      attention: n(problems) ? { text: `${n(problems)} kërkojnë kontroll`, href: `${base}/orders`, tone: "danger" } : undefined,
      empty: used.has("orders") ? undefined : { text: "Porositë krijohen nga bisedat me klientët ose shtohen nga ti.",
        actions: [{ label: "Hap porositë", href: `${base}/orders` }] } };
  })());
  if (on("bookings")) cards.push((async () => {
    const booked = () => count("bookings").neq("status", "cancelled");
    const [today, tomorrow, unconfirmed] = await Promise.all([
      booked().gte("starts_at", range.todayFrom).lt("starts_at", range.tomorrowFrom),
      booked().gte("starts_at", range.tomorrowFrom).lt("starts_at", range.dayAfterFrom),
      count("bookings").eq("status", "pending").gte("starts_at", now.toISOString()),
    ]);
    return { id: "bookings", label: "Rezervimet", icon: moduleRegistry.bookings.icon, href: `${base}/bookings`, value: n(today), caption: "sot",
      detail: `${n(tomorrow)} nesër`,
      attention: n(unconfirmed) ? { text: `${n(unconfirmed)} pa konfirmuar`, href: `${base}/bookings`, tone: "warning" } : undefined,
      empty: used.has("bookings") ? undefined : { text: "Klientët rezervojnë në bisedë sipas shërbimeve dhe orarit tënd.",
        actions: [{ label: "Cakto orarin", href: `${base}/calendar` }] } };
  })());
  if (on("leads")) cards.push((async () => {
    const followUp = leadSettings(settings?.lead_settings).followUpHours * 3_600_000;
    const [total, fresh, waiting] = await Promise.all([
      count("leads"), since("leads"),
      count("leads").eq("status", "new").lt("last_interest_at", new Date(now.getTime() - followUp).toISOString()),
    ]);
    return { id: "leads", label: "Leads", icon: moduleRegistry.leads.icon, href: `${base}/leads`, value: n(total), caption: "gjithsej",
      detail: added(n(fresh), "të reja"), detailTone: "up",
      attention: n(waiting) ? { text: `${n(waiting)} presin përgjigje`, href: `${base}/leads?view=waiting`, tone: "warning" } : undefined,
      empty: n(total) ? undefined : { text: "Këtu dalin klientët që treguan interes në bisedë, por ende nuk blenë.",
        actions: [{ label: "Hap leads", href: `${base}/leads` }] } };
  })());
  if (on("customers")) cards.push((async () => {
    const [total, fresh] = await Promise.all([count("customers").is("archived_at", null), since("customers").is("archived_at", null)]);
    return { id: "customers", label: "Klientët", icon: moduleRegistry.customers.icon, href: `${base}/customers`, value: n(total), caption: "gjithsej",
      detail: added(n(fresh), "të rinj"), detailTone: "up",
      empty: n(total) ? undefined : { text: "Klientët shtohen vetë nga bisedat; mund t'i shtosh edhe ti.",
        actions: [{ label: "Hap klientët", href: `${base}/customers` }] } };
  })());
  if (on("knowledge")) cards.push((async () => {
    const [total, { data: jobs }] = await Promise.all([
      count("knowledge_entries").eq("is_active", true),
      db.from("business_discovery_jobs").select("checkpoint").eq("business_id", id).eq("status", "completed").not("input->>review", "is", null),
    ]);
    const proposed = (jobs ?? []).filter((job) => job.checkpoint?.review?.status === "pending")
      .reduce((sum, job) => sum + (Array.isArray(job.checkpoint.review.knowledgeIds) ? job.checkpoint.review.knowledgeIds.length : 0), 0);
    return { id: "knowledge", label: "Njohuritë", icon: moduleRegistry.knowledge.icon, href: `${base}/knowledge`, value: n(total), caption: "aktive",
      attention: proposed ? { text: `${proposed} për konfirmim`, href: `${base}/knowledge`, tone: "warning" } : undefined,
      empty: n(total) || proposed ? undefined : { text: "Agjenti përgjigjet vetëm me atë që di: politikat, oraret, pyetjet e shpeshta.",
        actions: [{ label: "Shto njohuri", href: `${base}/knowledge` }] } };
  })());
  if (on("catalogs")) cards.push((async () => {
    const [total, failed] = await Promise.all([count("catalogs").eq("active", true), count("catalogs").eq("index_status", "failed")]);
    return { id: "catalogs", label: "Katalogët", icon: moduleRegistry.catalogs.icon, href: `${base}/catalogs`, value: n(total), caption: "aktivë",
      attention: n(failed) ? { text: `${n(failed)} me gabim`, href: `${base}/catalogs`, tone: "danger" } : undefined,
      empty: n(total) ? undefined : { text: "Ngarko katalogë ose dokumente që Agjenti t'i përdorë në përgjigje.",
        actions: [{ label: "Ngarko katalog", href: `${base}/catalogs` }] } };
  })());

  const link = (id: ModuleId): HomeModuleLink => ({
    id, label: moduleRegistry[id].label, description: moduleRegistry[id].description, icon: moduleRegistry[id].icon,
    href: `${base}/${moduleRegistry[id].path}`,
    requires: [...(moduleDependencies[id].requires ?? []), ...(moduleDependencies[id].requiresAny ?? [])].map((dep) => moduleRegistry[dep].label),
  });
  // Highlighted modules without figures yet (calendar, workflows) open the module.
  const counted = new Set(["products", "services", "orders", "bookings", "leads", "customers", "knowledge", "catalogs"]);
  for (const extra of split.highlighted.filter((m) => !counted.has(m))) {
    const { label, description, icon, href } = link(extra);
    cards.push(Promise.resolve({ id: extra, label, icon, href, value: null, caption: description }));
  }

  const [inbox, ...rest] = await Promise.all([
    profile.enabledModules.includes("inbox") ? messages().catch(() => null) : Promise.resolve(null),
    ...cards.map((card) => card.catch(() => null)),
  ]);
  const order = (card: HomeCard) => split.highlighted.indexOf(card.id as ModuleId);
  return {
    period, messages: inbox,
    cards: rest.filter((card): card is HomeCard => !!card).sort((a, b) => order(a) - order(b)),
    others: split.others.map(link),
  };
}
