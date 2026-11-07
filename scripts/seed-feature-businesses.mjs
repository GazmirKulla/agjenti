#!/usr/bin/env node
/**
 * Creates five complementary demo businesses for platform-admin feature coverage.
 * Idempotent on slug. Does not connect live Instagram/WhatsApp or create bookings.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

loadEnv(new URL("../.env.local", import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.TEST_ADMIN_EMAIL?.trim().toLowerCase();
if (!url || !key) throw new Error("Mungojnë NEXT_PUBLIC_SUPABASE_URL ose SUPABASE_SERVICE_ROLE_KEY.");
if (!adminEmail) throw new Error("Mungon TEST_ADMIN_EMAIL në .env.local.");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const CORE = ["dashboard", "inbox", "agents", "sources", "instagram", "whatsapp", "settings"];
const TOGGLE = ["products", "services", "orders", "bookings", "calendar", "catalogs", "leads", "customers", "knowledge", "workflows"];

function profile(signals, extraModules) {
  const enabled = [...new Set([...CORE, ...extraModules])];
  return {
    version: 1,
    source: "manual",
    enabledModules: enabled,
    hiddenModules: TOGGLE.filter((id) => !enabled.includes(id)),
    navigationItems: ["dashboard", "inbox", "products", "services", "catalogs", "orders", "bookings", "calendar", "leads", "customers", "agents", "knowledge", "workflows", "sources", "instagram", "whatsapp", "settings"].filter((id) => enabled.includes(id)),
    mobileNavigationItems: enabled.filter((id) => ["dashboard", "inbox", "products", "services", "catalogs", "orders", "bookings"].includes(id)).slice(0, 4),
    widgets: [
      { id: "conversations", label: "Biseda", hint: "Mesazhe në rrjedhë", icon: "inbox", stat: "conversations" },
      { id: "customers", label: "Klientë", hint: "Të regjistruar", icon: "customers", tone: "blue", stat: "customers" },
      { id: "agents", label: "Agjentë aktivë", hint: "Konfigurimi", icon: "agents", stat: "agents" },
      { id: "instagram", label: "Instagram i lidhur", hint: "Lidhja e kanalit", icon: "instagram", tone: "pink", stat: "connections" },
    ],
    primaryActions: extraModules.includes("products")
      ? [{ id: "add_product", label: "Shto produkt", href: "products", icon: "products" }]
      : extraModules.includes("bookings")
        ? [{ id: "add_booking", label: "Shto rezervim", href: "bookings", icon: "orders" }]
        : [{ id: "open_inbox", label: "Shiko mesazhet", href: "inbox", icon: "inbox" }],
    signals,
  };
}

function node(id, kind, label, x, y, config = {}) {
  return { id, kind, label, position: { x, y }, config };
}
function edge(id, source, target, port = "next") {
  return { id, source, target, port };
}
function flow(id, label, kind, entryNodeId, nodeIds, extra = {}) {
  return { id, label, kind, entryNodeId, nodeIds, purpose: extra.purpose, offerPolicy: extra.offerPolicy ?? "when_relevant", ...("productIds" in extra ? { productIds: extra.productIds } : {}), ...("serviceIds" in extra ? { serviceIds: extra.serviceIds } : {}) };
}

function retailGraph(productIds) {
  return {
    version: 2,
    name: "Rrjedha e klientit",
    nodes: [
      node("start", "start", "Mesazh i ri", 20, 60),
      node("support", "condition", "Kërkon ndihmën e stafit?", 280, 60, { condition: "intent_support" }),
      node("handoff", "handoff", "Kalo te stafi", 560, 20, { prompt: "Po ia kaloj kërkesën stafit të Atelier Nora." }),
      node("end0", "end", "Prit mesazhin tjetër", 560, 120),
      node("product", "product", "Porosit veshjen", 280, 240, { prompt: "Cilën veshje dëshiron? Thuaj modelin dhe masën (p.sh. Bluzë Nora S)." }),
      node("end_order", "end", "Porosia u përgatit", 560, 240),
      node("status", "order_status", "Statusi i porosisë", 280, 380),
      node("end_status", "end", "Statusi u dha", 560, 380),
      node("knowledge", "knowledge", "Përgjigju nga njohuritë", 280, 520),
      node("end_info", "end", "Informacioni u dha", 560, 520),
    ],
    edges: [
      edge("e1", "start", "support"),
      edge("e2", "support", "handoff", "yes"),
      edge("e3", "support", "end0", "no"),
      edge("e4", "product", "end_order"),
      edge("e5", "status", "end_status"),
      edge("e6", "knowledge", "end_info"),
    ],
    flows: [
      flow("flow_support", "Staf", "support", "support", ["support", "handoff"], { purpose: "Kalimi te stafi kur klienti kërkon njeri.", offerPolicy: "on_request" }),
      flow("flow_order", "Porosi veshjesh", "order", "product", ["product", "end_order"], { purpose: "Porosia e veshjeve me masa dhe ngjyra.", productIds }),
      flow("flow_status", "Statusi i porosisë", "information", "status", ["status", "end_status"], { purpose: "Lexon statusin e porosive të kësaj bisede." }),
      flow("flow_info", "Informacion", "information", "knowledge", ["knowledge", "end_info"], { purpose: "Pyetje për materiale, dërgesa dhe kthime." }),
    ],
  };
}

function giftGraph(productIds) {
  return {
    version: 2,
    name: "Rrjedha e klientit",
    nodes: [
      node("start", "start", "Mesazh i ri", 20, 60),
      node("support", "condition", "Kërkon ndihmën e stafit?", 280, 60, { condition: "intent_support" }),
      node("handoff", "handoff", "Kalo te stafi", 560, 20, { prompt: "Po ia kaloj kërkesën stafit të Dhurata ime." }),
      node("end0", "end", "Prit mesazhin tjetër", 560, 120),
      node("product", "product", "Zgjidh dhuratën", 80, 240, { prompt: "Cilën dhuratë dëshiron të personalizosh?" }),
      node("photo", "collect", "Foto e personalizimit", 280, 240, { fieldKey: "photo_gift", fieldType: "photo", prompt: "Dërgo foton që do të printojmë (ose përshkruaje nëse je në tekst)." }),
      node("text", "collect", "Teksti mbi dhuratë", 480, 240, { fieldKey: "text_gift", fieldType: "text", prompt: "Çfarë teksti ose emri do të shkruajmë mbi dhuratë?" }),
      node("confirm", "confirm", "Konfirmo personalizimin", 680, 240, { prompt: "I konfirmon këto të dhëna për printimin e dhuratës?" }),
      node("end_order", "end", "Porosia u përgatit", 880, 240),
      node("knowledge", "knowledge", "Përgjigju nga njohuritë", 280, 420),
      node("end_info", "end", "Informacioni u dha", 560, 420),
    ],
    edges: [
      edge("e1", "start", "support"),
      edge("e2", "support", "handoff", "yes"),
      edge("e3", "support", "end0", "no"),
      edge("e4", "product", "photo"),
      edge("e5", "photo", "text"),
      edge("e6", "text", "confirm"),
      edge("e7", "confirm", "end_order", "yes"),
      edge("e8", "confirm", "photo", "no"),
      edge("e9", "knowledge", "end_info"),
    ],
    flows: [
      flow("flow_support", "Staf", "support", "support", ["support", "handoff"], { purpose: "Kalimi te stafi.", offerPolicy: "on_request" }),
      flow("flow_order", "Dhuratë e personalizuar", "order", "product", ["product", "photo", "text", "confirm", "end_order"], { purpose: "Porosi dhuratash me foto dhe tekst.", productIds }),
      flow("flow_info", "Informacion", "information", "knowledge", ["knowledge", "end_info"], { purpose: "Afate printimi, materiale dhe kthime." }),
    ],
  };
}

function salonGraph(serviceIds) {
  return {
    version: 2,
    name: "Rrjedha e klientit",
    nodes: [
      node("start", "start", "Mesazh i ri", 20, 60),
      node("support", "condition", "Kërkon ndihmën e stafit?", 280, 60, { condition: "intent_support" }),
      node("handoff", "handoff", "Kalo te stafi", 560, 20, { prompt: "Po ia kaloj kërkesën stafit të Studio Lule." }),
      node("end0", "end", "Prit mesazhin tjetër", 560, 120),
      node("booking", "booking", "Rezervo shërbimin", 280, 260),
      node("end_book", "end", "Rezervimi u ruajt", 560, 260),
      node("knowledge", "knowledge", "Përgjigju nga njohuritë", 280, 400),
      node("end_info", "end", "Informacioni u dha", 560, 400),
    ],
    edges: [
      edge("e1", "start", "support"),
      edge("e2", "support", "handoff", "yes"),
      edge("e3", "support", "end0", "no"),
      edge("e4", "booking", "end_book"),
      edge("e5", "knowledge", "end_info"),
    ],
    flows: [
      flow("flow_support", "Staf", "support", "support", ["support", "handoff"], { purpose: "Kalimi te stafistja.", offerPolicy: "on_request" }),
      flow("flow_book", "Rezervim", "booking", "booking", ["booking", "end_book"], { purpose: "Rezervim i prerjes, ngjyrës ose manikyrës.", serviceIds }),
      flow("flow_info", "Informacion", "information", "knowledge", ["knowledge", "end_info"], { purpose: "Çmimet, kohëzgjatja dhe kujdesi pas shërbimit." }),
    ],
  };
}

function restaurantGraph(productIds, serviceIds) {
  return {
    version: 2,
    name: "Rrjedha e klientit",
    nodes: [
      node("start", "start", "Mesazh i ri", 20, 60),
      node("support", "condition", "Kërkon ndihmën e stafit?", 280, 60, { condition: "intent_support" }),
      node("handoff", "handoff", "Kalo te stafi", 560, 20, { prompt: "Po ia kaloj kërkesën stafit të Kuzhinës së Gurit." }),
      node("end0", "end", "Prit mesazhin tjetër", 560, 120),
      node("product", "product", "Porosit nga menuja", 280, 240, { prompt: "Çfarë dëshiron nga menuja për ngrënie jashtë?" }),
      node("end_order", "end", "Porosia u përgatit", 560, 240),
      node("booking", "booking", "Rezervo tavolinën", 280, 380),
      node("end_book", "end", "Tavolina u rezervua", 560, 380),
      node("knowledge", "knowledge", "Përgjigju nga njohuritë", 280, 520),
      node("end_info", "end", "Informacioni u dha", 560, 520),
    ],
    edges: [
      edge("e1", "start", "support"),
      edge("e2", "support", "handoff", "yes"),
      edge("e3", "support", "end0", "no"),
      edge("e4", "product", "end_order"),
      edge("e5", "booking", "end_book"),
      edge("e6", "knowledge", "end_info"),
    ],
    flows: [
      flow("flow_support", "Staf", "support", "support", ["support", "handoff"], { purpose: "Kalimi te kamerieri ose kuzhina.", offerPolicy: "on_request" }),
      flow("flow_order", "Porosi nga menuja", "order", "product", ["product", "end_order"], { purpose: "Porosi ushqimi për ngrënie jashtë.", productIds }),
      flow("flow_book", "Rezervim tavoline", "booking", "booking", ["booking", "end_book"], { purpose: "Rezervim tavoline në restorant.", serviceIds }),
      flow("flow_info", "Informacion", "information", "knowledge", ["knowledge", "end_info"], { purpose: "Orari, alergjitë dhe menuja e ditës." }),
    ],
  };
}

function wholesaleGraph(productIds) {
  return {
    version: 2,
    name: "Rrjedha e klientit",
    nodes: [
      node("start", "start", "Mesazh i ri", 20, 60),
      node("support", "condition", "Kërkon ndihmën e stafit?", 280, 60, { condition: "intent_support" }),
      node("handoff", "handoff", "Kalo te stafi", 560, 20, { prompt: "Po ia kaloj kërkesën ekipit tregtar të ProMaterial." }),
      node("end0", "end", "Prit mesazhin tjetër", 560, 120),
      node("lead_name", "collect", "Emri i kontaktit", 80, 260, { fieldKey: "lead_name", fieldType: "text", prompt: "Si quheni ju ose firma juaj?" }),
      node("lead_email", "collect", "Email profesional", 280, 260, { fieldKey: "lead_email", fieldType: "email", prompt: "Cilin email profesional të përdorim për ofertën?" }),
      node("lead_company", "collect", "Projekti ose industria", 480, 260, { fieldKey: "lead_company", fieldType: "text", prompt: "Për cilin projekt ose industri ju duhen materialet?" }),
      node("confirm", "confirm", "Konfirmo kërkesën", 680, 260, { prompt: "T’ia dërgoj këto të dhëna ekipit tregtar për një ofertë?" }),
      node("end_lead", "end", "Kërkesa u ruajt", 880, 260, { prompt: "Kërkesa u ruajt. Stafi tregtar ju shkruan me ofertë; në këtë bisedë nuk u dërgua katalog i jashtëm automatikisht." }),
      node("knowledge", "knowledge", "Përgjigju nga njohuritë", 280, 420),
      node("end_info", "end", "Informacioni u dha", 560, 420),
    ],
    edges: [
      edge("e1", "start", "support"),
      edge("e2", "support", "handoff", "yes"),
      edge("e3", "support", "end0", "no"),
      edge("e4", "lead_name", "lead_email"),
      edge("e5", "lead_email", "lead_company"),
      edge("e6", "lead_company", "confirm"),
      edge("e7", "confirm", "end_lead", "yes"),
      edge("e8", "confirm", "lead_name", "no"),
      edge("e9", "knowledge", "end_info"),
    ],
    flows: [
      flow("flow_support", "Staf", "support", "support", ["support", "handoff"], { purpose: "Kalimi te ekipi tregtar.", offerPolicy: "on_request" }),
      flow("flow_lead", "Kërkesë B2B", "custom", "lead_name", ["lead_name", "lead_email", "lead_company", "confirm", "end_lead"], { purpose: "Mbledh kontaktin dhe projektin para ofertës me shumicë." }),
      flow("flow_info", "Informacion", "information", "knowledge", ["knowledge", "end_info"], { purpose: "Specifikime, kushte B2B dhe katalogë." }),
    ],
  };
}

function throwIf(error, context) {
  if (error) throw new Error(`${context}: ${error.message || error.code || error}`);
}

async function typeId(types, key) {
  const row = types.find((t) => t.external_key === key) || types.find((t) => t.is_active);
  if (!row) throw new Error("Nuk ka lloje produktesh aktive.");
  return row.id;
}

async function upsertBusiness({ slug, name, ownerId, dashboard, autoReply = true }) {
  const existing = await db.from("businesses").select("id,slug").eq("slug", slug).maybeSingle();
  throwIf(existing.error, `leximi i ${slug}`);
  let id = existing.data?.id;
  if (!id) {
    const created = await db.from("businesses").insert({
      name, slug, catalog_source: "internal", auto_reply: autoReply, dashboard_profile: dashboard, timezone: "Europe/Tirane",
    }).select("id").single();
    if (created.error && /timezone|PGRST204|42703/.test(`${created.error.message}${created.error.code}`)) {
      const retry = await db.from("businesses").insert({
        name, slug, catalog_source: "internal", auto_reply: autoReply, dashboard_profile: dashboard,
      }).select("id").single();
      throwIf(retry.error, `krijimi i ${slug}`);
      id = retry.data.id;
    } else {
      throwIf(created.error, `krijimi i ${slug}`);
      id = created.data.id;
    }
  } else {
    const updated = await db.from("businesses").update({
      name, auto_reply: autoReply, dashboard_profile: dashboard, updated_at: new Date().toISOString(),
    }).eq("id", id);
    throwIf(updated.error, `përditësimi i ${slug}`);
  }
  const member = await db.from("business_users").upsert(
    { business_id: id, user_id: ownerId, role: "owner" },
    { onConflict: "business_id,user_id" },
  );
  throwIf(member.error, `anëtarësimi i ${slug}`);
  return id;
}

async function upsertAgent(businessId, name, instructions) {
  const found = await db.from("ai_agents").select("id").eq("business_id", businessId).order("created_at").limit(1);
  throwIf(found.error, "agjenti");
  if (found.data?.[0]?.id) {
    const updated = await db.from("ai_agents").update({
      name: `Agjenti i ${name}`, instructions, is_active: true, updated_at: new Date().toISOString(),
    }).eq("id", found.data[0].id).eq("business_id", businessId);
    throwIf(updated.error, "përditësimi i agjentit");
    return;
  }
  const created = await db.from("ai_agents").insert({
    business_id: businessId, name: `Agjenti i ${name}`, instructions, is_active: true,
  });
  throwIf(created.error, "krijimi i agjentit");
}

async function upsertKnowledge(businessId, entries) {
  for (const entry of entries) {
    const existing = await db.from("knowledge_entries").select("id").eq("business_id", businessId).eq("title", entry.title).maybeSingle();
    throwIf(existing.error, "njohuria");
    if (existing.data?.id) {
      const updated = await db.from("knowledge_entries").update({
        body: entry.body, intent_key: entry.intent_key ?? null, is_active: true, updated_at: new Date().toISOString(),
      }).eq("id", existing.data.id).eq("business_id", businessId);
      throwIf(updated.error, `njohuria ${entry.title}`);
      continue;
    }
    const created = await db.from("knowledge_entries").insert({
      business_id: businessId, title: entry.title, body: entry.body, intent_key: entry.intent_key ?? null, is_active: true,
    });
    throwIf(created.error, `njohuria ${entry.title}`);
  }
}

async function upsertProducts(businessId, type, rows) {
  const ids = [];
  for (const row of rows) {
    const existing = await db.from("products").select("id").eq("business_id", businessId).eq("sku", row.sku).maybeSingle();
    throwIf(existing.error, "produktet");
    const payload = {
      business_id: businessId,
      name: row.name,
      description: row.description,
      sku: row.sku,
      price_amount: row.price,
      currency: row.currency ?? "ALL",
      product_type_id: type,
      is_active: true,
      source: "manual",
      updated_at: new Date().toISOString(),
    };
    if (existing.data?.id) {
      const updated = await db.from("products").update(payload).eq("id", existing.data.id).eq("business_id", businessId);
      throwIf(updated.error, `produkti ${row.sku}`);
      ids.push(existing.data.id);
    } else {
      const created = await db.from("products").insert(payload).select("id").single();
      throwIf(created.error, `produkti ${row.sku}`);
      ids.push(created.data.id);
    }
  }
  return ids;
}

async function upsertServices(businessId, rows) {
  const ids = [];
  for (const row of rows) {
    const existing = await db.from("booking_services").select("id").eq("business_id", businessId).eq("name", row.name).maybeSingle();
    throwIf(existing.error, "shërbimet");
    const payload = {
      business_id: businessId,
      name: row.name,
      description: row.description,
      category: row.category,
      price_amount: row.price,
      currency: row.currency ?? "ALL",
      price_mode: "fixed",
      booking_enabled: true,
      duration_minutes: row.duration,
      buffer_minutes: row.buffer ?? 10,
      is_active: true,
    };
    if (existing.data?.id) {
      const updated = await db.from("booking_services").update(payload).eq("id", existing.data.id).eq("business_id", businessId);
      throwIf(updated.error, `shërbimi ${row.name}`);
      ids.push(existing.data.id);
    } else {
      const created = await db.from("booking_services").insert(payload).select("id").single();
      throwIf(created.error, `shërbimi ${row.name}`);
      ids.push(created.data.id);
    }
  }
  return ids;
}

async function upsertCalendar(businessId, hours, agentBooking) {
  const payload = {
    business_id: businessId,
    timezone: "Europe/Tirane",
    hours,
    closed_dates: [],
    confirmation_mode: "manual",
    agent_booking_enabled: agentBooking,
    updated_at: new Date().toISOString(),
  };
  const saved = await db.from("business_calendar_settings").upsert(payload, { onConflict: "business_id" });
  throwIf(saved.error, "kalendari");
}

async function upsertCustomers(businessId, rows) {
  for (const row of rows) {
    const existing = await db.from("customers").select("id").eq("business_id", businessId).eq("display_name", row.display_name).maybeSingle();
    throwIf(existing.error, "klientët");
    if (existing.data?.id) continue;
    const created = await db.from("customers").insert({
      business_id: businessId, display_name: row.display_name, phone: row.phone, username: row.username ?? null,
    });
    throwIf(created.error, `klienti ${row.display_name}`);
  }
}

async function publishWorkflow(businessId, userId, graph) {
  const current = await db.from("visual_workflows").select("revision").eq("business_id", businessId).maybeSingle();
  throwIf(current.error, "workflow");
  const revision = current.data?.revision ?? 0;
  const saved = await db.rpc("save_visual_workflow", {
    p_business: businessId,
    p_user: userId,
    p_revision: revision,
    p_graph: graph,
    p_operation: "publish",
  });
  throwIf(saved.error, "publikimi i workflow");
}

async function seedCatalog(businessId, title, sections) {
  const existing = await db.from("catalogs").select("id,revision,index_status").eq("business_id", businessId).eq("title", title).maybeSingle();
  throwIf(existing.error, "katalogu");
  let id = existing.data?.id;
  if (!id) {
    const created = await db.from("catalogs").insert({
      business_id: businessId,
      title,
      source_type: "text",
      description: "Katalog teknik B2B për tregtarë dhe kontraktorë.",
      use_when: ["b2b", "technical", "commercial"],
      qualification_fields: ["industry", "purpose", "capacity"],
    }).select("id,revision").single();
    throwIf(created.error, "krijimi i katalogut");
    id = created.data.id;
  }
  const claimed = await db.rpc("claim_catalog_index", { p_id: id, p_business: businessId });
  throwIf(claimed.error, "indeksimi i katalogut");
  const row = Array.isArray(claimed.data) ? claimed.data[0] : claimed.data;
  if (!row?.id) throw new Error("Katalogu nuk u kalua në indeksim.");
  const finished = await db.rpc("finish_catalog_index", {
    p_id: id,
    p_business: businessId,
    p_revision: row.revision,
    p_metadata: {
      categories: ["çelik", "tuba", "fiksues"],
      brands: ["ProMaterial"],
      years: ["2026"],
      productFamilies: ["Tuba çeliku", "Fletë metalike", "Fiksues"],
      applications: ["ndërtim", "impiant"],
      industries: ["ndërtim", "industri"],
      specifications: ["EN 10255", "S235JR"],
      terminology: ["DN", "schedule"],
      languages: ["sq"],
      markets: ["Shqipëri", "Kosovë"],
      audiences: ["tregtar", "kontraktor"],
    },
    p_summary: "Katalogu teknik i ProMaterial: tuba, fletë dhe fiksues për tregtarë.",
    p_coverage: "Gama 2026 e materialeve metalike për shitje me shumicë.",
    p_sections: sections,
  });
  throwIf(finished.error, "përfundimi i indeksit");
  const ready = await db.from("catalogs").select("revision").eq("id", id).eq("business_id", businessId).single();
  throwIf(ready.error, "revisioni i katalogut");
  const activated = await db.from("catalogs").update({
    active: true,
    index_status: "ready",
    confirmed_at: new Date().toISOString(),
    revision: ready.data.revision + 1,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("business_id", businessId).eq("revision", ready.data.revision);
  throwIf(activated.error, "aktivizimi i katalogut");
}

function weekdayHours(days, start, end) {
  return days.map((day) => ({ day, start, end }));
}

async function main() {
  const owner = await db.from("profiles").select("id").eq("email", adminEmail).maybeSingle();
  throwIf(owner.error, "profili");
  if (!owner.data?.id) throw new Error("TEST_ADMIN_EMAIL nuk ka profil.");
  const ownerId = owner.data.id;

  const types = await db.from("product_types").select("id,name,external_key,is_active").eq("is_active", true);
  throwIf(types.error, "llojet");
  const variantType = await typeId(types.data ?? [], "variants");
  const personalType = await typeId(types.data ?? [], "personalized");
  const standardType = await typeId(types.data ?? [], "standard");

  const businesses = [];

  {
    const slug = "atelier-nora";
    const name = "Atelier Nora";
    const signals = {
      businessType: "retail",
      offeringTypes: ["variants"],
      selectedUseCases: ["support", "sales", "orders"],
      agentCapabilities: ["reply_messages", "answer_questions", "ask_missing", "handoff", "recommend_products", "compare_products", "answer_product_details", "collect_order_details", "follow_workflow", "create_order"],
      workflow: "variant-order",
    };
    const id = await upsertBusiness({
      slug, name, ownerId, autoReply: true,
      dashboard: profile(signals, ["products", "orders", "knowledge", "workflows", "customers"]),
    });
    await upsertAgent(id, name, `Je asistenti i ${name}, dyqan veshjesh në Tiranë. Përgjigju në shqip ose në gjuhën e klientit. Mos shpik çmime ose stok. Përdor katalogun (bluzë, xhup, xhinse me masa S/M/L) dhe njohuritë. Porosia përgatitet për stafin pas konfirmimit; nuk dërgohet te një furnitor i jashtëm. Për kthime, dërgesa dhe materiale përdor njohuritë. Nëse klienti kërkon njeri, kalo te stafi.`);
    const products = await upsertProducts(id, variantType, [
      { sku: "NORA-BLU-S", name: "Bluzë Nora S", description: "Bluzë pambuku, ngjyrë e zezë, masa S. Prodhuar për veshje të përditshme.", price: 2900 },
      { sku: "NORA-BLU-M", name: "Bluzë Nora M", description: "Bluzë pambuku, ngjyrë e zezë, masa M.", price: 2900 },
      { sku: "NORA-BLU-L", name: "Bluzë Nora L", description: "Bluzë pambuku, ngjyrë e zezë, masa L.", price: 2900 },
      { sku: "NORA-XHU-M", name: "Xhup Nora M", description: "Xhup i lehtë, ngjyrë kafe, masa M. I përshtatshëm për vjeshtë.", price: 8900 },
      { sku: "NORA-XHU-L", name: "Xhup Nora L", description: "Xhup i lehtë, ngjyrë kafe, masa L.", price: 8900 },
      { sku: "NORA-XHI-M", name: "Xhinse Nora M", description: "Xhinse blu, masa M, prerje e drejtë.", price: 4900 },
    ]);
    await upsertKnowledge(id, [
      { title: "Dërgesa", body: "Dërgesa brenda Tiranës bëhet të nesërmen e punës. Jashtë Tiranës 2–4 ditë pune. Kostoja e dërgesës është 200 lekë; mbi 8,000 lekë dërgesa është falas. Nuk dërgojmë të shtunën dhe të dielën.", intent_key: "shipping" },
      { title: "Kthime", body: "Produktet e papërdorura kthehen brenda 14 ditëve me faturë. Rrobat e personalizuara nuk kthehen. Kthimi bëhet në dyqan ose me korrier me kosto të klientit.", intent_key: "returns" },
      { title: "Materialet", body: "Bluza Nora është 100% pambuk. Xhupi ka shtresë të jashtme poliestër. Xhinset janë denim stretch. Nuk pretendojmë certifikata që nuk janë në këtë njohuri.", intent_key: "materials" },
      { title: "Dyqani", body: "Atelier Nora ndodhet në Tiranë. Orari: e hënë–e shtunë 10:00–19:00. Të dielën jemi mbyllur. Provat e veshjeve bëhen në dyqan, jo me rezervim online.", intent_key: "store" },
    ]);
    await upsertCustomers(id, [
      { display_name: "Elira Kola", phone: "+355690000101" },
      { display_name: "Arben Hoxha", phone: "+355690000102" },
    ]);
    await publishWorkflow(id, ownerId, retailGraph(products));
    businesses.push({ name, slug, id });
  }

  {
    const slug = "dhurata-ime";
    const name = "Dhurata ime";
    const signals = {
      businessType: "retail",
      offeringTypes: ["personalized", "photo", "text"],
      selectedUseCases: ["support", "sales", "orders"],
      agentCapabilities: ["reply_messages", "answer_questions", "ask_missing", "handoff", "recommend_products", "collect_order_details", "follow_workflow", "create_order"],
      workflow: "personalized-order",
    };
    const id = await upsertBusiness({
      slug, name, ownerId, autoReply: true,
      dashboard: profile(signals, ["products", "orders", "knowledge", "workflows", "customers"]),
    });
    await upsertAgent(id, name, `Je asistenti i ${name}, punëtori dhuratash të personalizuara. Përgjigju në shqip ose në gjuhën e klientit. Mos shpik çmime. Për çdo porosi duhet produkti, fotoja e printimit dhe teksti. Printimi fillon pas konfirmimit; nuk është dërgesë e jashtme e automatizuar. Afati i printimit është 3–5 ditë pune pas konfirmimit.`);
    const products = await upsertProducts(id, personalType, [
      { sku: "DHU-KUPE", name: "Kupë me foto", description: "Kupë qeramike e bardhë, printim fotoje dhe tekst deri në 40 shenja.", price: 1500 },
      { sku: "DHU-JAST", name: "Jastëk me emër", description: "Jastëk 40x40 cm, printim fotoje në njërën anë dhe emër në tjetrën.", price: 2200 },
      { sku: "DHU-BLUZ", name: "Bluzë me print", description: "Bluzë pambuku me printim fotoje A4. Masat S/M/L zgjidhen në mesazh.", price: 2500 },
      { sku: "DHU-KORN", name: "Kornizë druri", description: "Kornizë 15x20 cm me foto të printuar.", price: 1800 },
    ]);
    await upsertKnowledge(id, [
      { title: "Personalizimi", body: "Na duhet një foto e qartë (JPG/PNG) dhe teksti që do të printohet. Nuk printojmë logo të markave të tjera pa leje. Nëse fotoja është e turbullt, e tregojmë para printimit.", intent_key: "personalization" },
      { title: "Afatet", body: "Printimi zgjat 3–5 ditë pune pas konfirmimit të fotos dhe tekstit. Dërgesa në Tiranë shtohet 1 ditë. Nuk premtojmë dërgesë të së njëjtës ditë.", intent_key: "lead_time" },
      { title: "Kthime", body: "Dhuratat e printuara sipas fotos suaj nuk kthehen, përveç gabimit të printimit nga ana jonë.", intent_key: "returns" },
    ]);
    await upsertCustomers(id, [
      { display_name: "Mira Dervishi", phone: "+355690000201" },
    ]);
    await publishWorkflow(id, ownerId, giftGraph(products));
    businesses.push({ name, slug, id });
  }

  {
    const slug = "studio-lule";
    const name = "Studio Lule";
    const signals = {
      businessType: "beauty",
      offeringTypes: ["services"],
      selectedUseCases: ["support", "booking", "leads"],
      agentCapabilities: ["reply_messages", "answer_questions", "ask_missing", "handoff", "handle_bookings", "qualify_leads"],
      workflow: "service-request",
    };
    const id = await upsertBusiness({
      slug, name, ownerId, autoReply: true,
      dashboard: profile(signals, ["services", "bookings", "calendar", "knowledge", "workflows", "staff", "customers", "leads"]),
    });
    await upsertAgent(id, name, `Je asistenti i ${name}, sallon bukurie në Tiranë. Përgjigju në shqip ose në gjuhën e klientit. Mos shpik orare të lira. Rezervimi kërkon shërbimin, datën dhe orën; stafi e konfirmon. Në test nuk njoftohet stafi real. Orari i sallonit: e martë–e shtunë 09:00–19:00. E hënë dhe e diel jemi mbyllur.`);
    const services = await upsertServices(id, [
      { name: "Prerje flokësh", description: "Prerje dhe stilizim. Përfshin larjen.", category: "Flokë", price: 1500, duration: 45 },
      { name: "Ngjyrë flokësh", description: "Ngjyrosje e plotë. Kohëzgjatja varet nga gjatësia; sloti bazë është 90 minuta.", category: "Flokë", price: 3500, duration: 90, buffer: 15 },
      { name: "Manikyr", description: "Manikyr klasik me lyerje.", category: "Thonj", price: 1200, duration: 50 },
      { name: "Pedikyr", description: "Pedikyr klasik.", category: "Thonj", price: 1500, duration: 60 },
    ]);
    await upsertKnowledge(id, [
      { title: "Orari", body: "Studio Lule punon të martën–të shtunën 09:00–19:00. Të hënën dhe të dielën jemi mbyllur. Rezervimi mbahet 10 minuta; pas kësaj sloti lirohet.", intent_key: "hours" },
      { title: "Kujdesi pas ngjyrës", body: "Pas ngjyrës mos lani flokët 48 orë. Përdorni shampo për flokë të lyera. Nuk japim këshilla mjekësore për alergji; nëse keni pasur reaksion, na e thoni para shërbimit.", intent_key: "aftercare" },
      { title: "Anulimi", body: "Anuloni të paktën 4 orë para orarit. Nëse vonoheni mbi 15 minuta, mund t’ju ofrojmë slotin tjetër të lirë.", intent_key: "cancel" },
    ]);
    await upsertCalendar(id, weekdayHours([2, 3, 4, 5, 6], "09:00", "19:00"), true);
    await upsertCustomers(id, [
      { display_name: "Ana Berisha", phone: "+355690000301" },
      { display_name: "Klara Meta", phone: "+355690000302" },
    ]);
    await publishWorkflow(id, ownerId, salonGraph(services));
    businesses.push({ name, slug, id });
  }

  {
    const slug = "kuzhina-e-gurit";
    const name = "Kuzhina e Gurit";
    const signals = {
      businessType: "food",
      offeringTypes: ["mixed"],
      selectedUseCases: ["support", "orders", "booking"],
      agentCapabilities: ["reply_messages", "answer_questions", "ask_missing", "handoff", "recommend_products", "collect_order_details", "create_order", "handle_bookings"],
      workflow: "service-or-product-request",
    };
    const id = await upsertBusiness({
      slug, name, ownerId, autoReply: true,
      dashboard: profile(signals, ["products", "services", "orders", "bookings", "calendar", "knowledge", "workflows", "staff", "customers"]),
    });
    await upsertAgent(id, name, `Je asistenti i restorantit ${name} në Tiranë. Dalloj porosinë për ngrënie jashtë nga rezervimin e tavolinës. Mos shpik orare të lira ose alergji. Menuja ka tave, qofte, sallatë dhe limonadë. Tavolinat janë për 2, 4 ose 6 persona. Orari: e martë–e diel 12:00–22:00. E hënë jemi mbyllur.`);
    const products = await upsertProducts(id, standardType, [
      { sku: "GUR-TAVE", name: "Tave dheu", description: "Tave tradicionale me mish dhe patate, porcion individual, për ngrënie jashtë.", price: 1200 },
      { sku: "GUR-QOF", name: "Qofte zogu", description: "Qofte pule me oriz, 8 copë.", price: 900 },
      { sku: "GUR-SAL", name: "Sallatë fshati", description: "Domate, kastravec, qepë, djathë. Mund të kërkohet pa qepë.", price: 500 },
      { sku: "GUR-LIM", name: "Limonadë shtëpie", description: "Limonadë e freskët, 0.4 L.", price: 250 },
    ]);
    const services = await upsertServices(id, [
      { name: "Tavolinë 2 persona", description: "Rezervim tavoline për dy persona në sallë.", category: "Tavolina", price: 0, duration: 90, buffer: 15 },
      { name: "Tavolinë 4 persona", description: "Rezervim tavoline për katër persona.", category: "Tavolina", price: 0, duration: 90, buffer: 15 },
      { name: "Tavolinë 6 persona", description: "Rezervim tavoline për gjashtë persona. Për grupe më të mëdha telefononi.", category: "Tavolina", price: 0, duration: 120, buffer: 20 },
    ]);
    await upsertKnowledge(id, [
      { title: "Orari", body: "E martë–e diel 12:00–22:00. E hënë mbyllur. Kuzhina mbyll porositë e ngrënies jashtë në 21:30.", intent_key: "hours" },
      { title: "Alergjitë", body: "Tavja përmban mish dhe patate. Qoftet përmbajnë vezë. Sallata ka djathë. Nuk jemi restorant pa gluten i certifikuar. Për alergji të rënda, flisni me stafin.", intent_key: "allergens" },
      { title: "Rezervimi", body: "Tavolina mbahet 15 minuta. Për mbi 6 persona na shkruani drejtpërdrejt stafit. Nuk pretendojmë vende në tarracë nëse nuk e konfirmon stafi.", intent_key: "tables" },
    ]);
    await upsertCalendar(id, weekdayHours([0, 2, 3, 4, 5, 6], "12:00", "22:00"), true);
    await upsertCustomers(id, [
      { display_name: "Gentian Leka", phone: "+355690000401" },
    ]);
    await publishWorkflow(id, ownerId, restaurantGraph(products, services));
    businesses.push({ name, slug, id });
  }

  {
    const slug = "promaterial";
    const name = "ProMaterial";
    const signals = {
      businessType: "manufacturing",
      offeringTypes: ["standard"],
      selectedUseCases: ["support", "leads", "sales"],
      agentCapabilities: ["reply_messages", "answer_questions", "ask_missing", "handoff", "qualify_leads", "recommend_products", "answer_product_details"],
      workflow: "catalog",
      catalogContext: "Katalogë teknikë PDF për tregtarë: tuba, fletë, fiksues. Çmimet me shumicë jepen pas kualifikimit të projektit.",
    };
    const id = await upsertBusiness({
      slug, name, ownerId, autoReply: true,
      dashboard: profile(signals, ["products", "catalogs", "leads", "knowledge", "workflows", "customers"]),
    });
    await upsertAgent(id, name, `Je asistenti B2B i ${name}, distributor materialesh metalike. Përgjigju në shqip ose në gjuhën e klientit. Katalogu teknik është për tregtarë dhe kontraktorë. Mos jep çmim me pakicë të shpikur. Çmimet me shumicë jepen nga ekipi tregtar pas emrit, emailit profesional dhe projektit. Në test nuk dërgohet ofertë e vërtetë me email.`);
    const products = await upsertProducts(id, standardType, [
      { sku: "PM-TUB-25", name: "Tub çeliku DN25", description: "Tub çeliku i salduar DN25, standard EN 10255, shitje me shumicë (metër).", price: 450 },
      { sku: "PM-TUB-50", name: "Tub çeliku DN50", description: "Tub çeliku i salduar DN50, EN 10255.", price: 890 },
      { sku: "PM-FLE-2", name: "Fletë S235JR 2mm", description: "Fletë metalike S235JR, trashësi 2 mm, shitje me fletë.", price: 3200 },
      { sku: "PM-BULL", name: "Bullona M12 komplet", description: "Komplet bullona M12 me dado, kuti 50 copë.", price: 1800 },
    ]);
    await upsertKnowledge(id, [
      { title: "Kushtet B2B", body: "Minimalisht 50,000 lekë për porosi me shumicë. Pagesa me faturë 15 ditë për klientët e regjistruar. Nuk shesim me pakicë në dyqan të hapur. Transporti llogaritet sipas peshës pas ofertës.", intent_key: "b2b" },
      { title: "Specifikimet", body: "Tubat ndjekin EN 10255. Fletët janë S235JR. Nuk zëvendësojmë standardin pa konfirmim të shkruar nga inxhinieri i projektit.", intent_key: "specs" },
    ]);
    await seedCatalog(id, "Katalogu teknik 2026", [
      { heading: "Tuba çeliku", text: "Gama DN25–DN100, EN 10255. Stoku lëviz; disponueshmëria konfirmohet në ofertë. Nuk është listë e çmimeve me pakicë.", page: 1, keywords: ["tuba", "DN", "EN10255"] },
      { heading: "Fletë metalike", text: "Fletë S235JR 1–4 mm. Përmasat standarde 1x2 m. Pritje me porosi pas konfirmimit tregtar.", page: 2, keywords: ["fletë", "S235JR"] },
      { heading: "Fiksues", text: "Bullona M8–M16, dado dhe rondele. Ambalazh kutie. Për projekte mbi 100 kuti, kërkoni ofertë.", page: 3, keywords: ["bullona", "fiksues"] },
    ]);
    await upsertCustomers(id, [
      { display_name: "Ndërtim Dajti sh.p.k.", phone: "+35542000111" },
      { display_name: "Impiant Plus", phone: "+35542000222" },
    ]);
    await publishWorkflow(id, ownerId, wholesaleGraph(products));
    businesses.push({ name, slug, id });
  }

  console.log("U krijuan / u përditësuan bizneset:");
  for (const row of businesses) console.log(`- ${row.name}  /b/${row.slug}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
