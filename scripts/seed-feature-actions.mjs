#!/usr/bin/env node
/**
 * Creates real calendar bookings and local orders for the five demo businesses.
 * Uses save_calendar_booking (same write path as the dashboard). Idempotent on request_key / external_order_id.
 * Does not connect live Instagram/WhatsApp or provision extra businesses.
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
if (!url || !key) throw new Error("Mungojnë NEXT_PUBLIC_SUPABASE_URL ose SUPABASE_SERVICE_ROLE_KEY.");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const TZ = "Europe/Tirane";
const SLUGS = ["atelier-nora", "dhurata-ime", "studio-lule", "kuzhina-e-gurit", "promaterial"];

function throwIf(error, label) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function zonedParts(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function localInstant(date, time, timezone = TZ) {
  const naive = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set();
  for (const delta of [-86400000, 0, 86400000]) {
    const at = naive + delta;
    const parts = zonedParts(new Date(at), timezone);
    offsets.add(Date.parse(`${parts.date}T${parts.time}:00Z`) - at);
  }
  const candidates = [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((at) => {
      const parts = zonedParts(at, timezone);
      return parts.date === date && parts.time === time;
    });
  if (candidates.length !== 1) throw new Error(`Ora e paqartë: ${date} ${time}`);
  return candidates[0].toISOString();
}

async function businessBySlug(slug) {
  const row = await db.from("businesses").select("id,name,slug").eq("slug", slug).maybeSingle();
  throwIf(row.error, slug);
  if (!row.data) throw new Error(`Biznesi ${slug} nuk u gjet.`);
  return row.data;
}

async function serviceByName(businessId, name) {
  const row = await db.from("booking_services").select("id,name").eq("business_id", businessId).eq("name", name).maybeSingle();
  throwIf(row.error, name);
  if (!row.data) throw new Error(`Shërbimi ${name} nuk u gjet.`);
  return row.data;
}

async function productBySku(businessId, sku) {
  const row = await db.from("products").select("id,name,sku,price_amount,currency,product_type_id").eq("business_id", businessId).eq("sku", sku).maybeSingle();
  throwIf(row.error, sku);
  if (!row.data) throw new Error(`Produkti ${sku} nuk u gjet.`);
  return row.data;
}

async function customerByName(businessId, displayName) {
  const row = await db.from("customers").select("id,display_name,phone").eq("business_id", businessId).eq("display_name", displayName).maybeSingle();
  throwIf(row.error, displayName);
  if (!row.data) throw new Error(`Klienti ${displayName} nuk u gjet.`);
  return row.data;
}

async function typeKey(productTypeId) {
  if (!productTypeId) return "standard";
  const row = await db.from("product_types").select("external_key,name").eq("id", productTypeId).maybeSingle();
  throwIf(row.error, "lloji");
  return row.data?.external_key || row.data?.name || "standard";
}

async function saveBooking({ businessId, service, name, contact, date, time, status, notes, requestKey }) {
  const start = localInstant(date, time);
  const saved = await db.rpc("save_calendar_booking", {
    p_business: businessId,
    p_id: null,
    p_revision: 0,
    p_service: service.id,
    p_name: name,
    p_contact: contact,
    p_start: start,
    p_status: status,
    p_notes: notes,
    p_request_key: requestKey,
  });
  throwIf(saved.error, `rezervimi ${requestKey}`);
  const booking = Array.isArray(saved.data) ? saved.data[0] : saved.data;
  return { id: booking.id, status: booking.status, starts_at: booking.starts_at, service: booking.service_name, replay: Boolean(booking.request_key === requestKey && booking.id) };
}

async function saveOrder({ businessId, customer, product, quantity = 1, status, externalId, options, notes }) {
  const existing = await db.from("orders").select("id,status").eq("business_id", businessId).eq("external_order_id", externalId).maybeSingle();
  throwIf(existing.error, `porosia ${externalId}`);
  if (existing.data?.id) return { id: existing.data.id, status: existing.data.status, replay: true };
  const created = await db.from("orders").insert({
    business_id: businessId,
    customer_id: customer.id,
    status,
    currency: product.currency,
    total_amount: Number(product.price_amount) * quantity,
    external_system: "manual",
    external_order_id: externalId,
    payload: {
      source: "manual",
      seed: true,
      sku: product.sku,
      productName: product.name,
      customerName: customer.display_name,
      notes,
      options,
    },
  }).select("id,status").single();
  throwIf(created.error, `porosia ${externalId}`);
  const item = await db.from("order_items").insert({
    order_id: created.data.id,
    product_id: product.id,
    product_type_key: await typeKey(product.product_type_id),
    quantity,
    options: options ?? {},
    unit_amount: product.price_amount,
  });
  throwIf(item.error, `rreshti ${externalId}`);
  return { id: created.data.id, status: created.data.status, replay: false };
}

async function main() {
  const nora = await businessBySlug("atelier-nora");
  const dhurata = await businessBySlug("dhurata-ime");
  const lule = await businessBySlug("studio-lule");
  const kuzhina = await businessBySlug("kuzhina-e-gurit");
  const promo = await businessBySlug("promaterial");

  const bookings = [];
  {
    const manikyr = await serviceByName(lule.id, "Manikyr");
    const prerje = await serviceByName(lule.id, "Prerje flokësh");
    const ngjyre = await serviceByName(lule.id, "Ngjyrë flokësh");
    const pedikyr = await serviceByName(lule.id, "Pedikyr");
    bookings.push(await saveBooking({
      businessId: lule.id, service: manikyr, name: "Ana Berisha", contact: "+355690000301",
      date: "2026-11-10", time: "10:00", status: "pending", notes: "Manikyr klasik, e re në sallon.",
      requestKey: "seed:studio-lule:manikyr-ana",
    }));
    bookings.push(await saveBooking({
      businessId: lule.id, service: prerje, name: "Klara Meta", contact: "+355690000302",
      date: "2026-11-10", time: "11:30", status: "confirmed", notes: "Prerje e konfirmuar nga stafi.",
      requestKey: "seed:studio-lule:prerje-klara",
    }));
    bookings.push(await saveBooking({
      businessId: lule.id, service: ngjyre, name: "Ana Berisha", contact: "+355690000301",
      date: "2026-11-11", time: "14:00", status: "pending", notes: "Ngjyrë e plotë, kërkon konfirmim.",
      requestKey: "seed:studio-lule:ngjyre-ana",
    }));
    bookings.push(await saveBooking({
      businessId: lule.id, service: pedikyr, name: "Klara Meta", contact: "+355690000302",
      date: "2026-11-14", time: "16:00", status: "confirmed", notes: "Pedikyr i shtunës.",
      requestKey: "seed:studio-lule:pedikyr-klara",
    }));
  }
  {
    const t2 = await serviceByName(kuzhina.id, "Tavolinë 2 persona");
    const t4 = await serviceByName(kuzhina.id, "Tavolinë 4 persona");
    const t6 = await serviceByName(kuzhina.id, "Tavolinë 6 persona");
    bookings.push(await saveBooking({
      businessId: kuzhina.id, service: t4, name: "Gentian Leka", contact: "+355690000401",
      date: "2026-11-08", time: "19:00", status: "pending", notes: "Darkë familjare, 4 persona.",
      requestKey: "seed:kuzhina-e-gurit:tavoline-4-gentian",
    }));
    bookings.push(await saveBooking({
      businessId: kuzhina.id, service: t2, name: "Elira Kola", contact: "+355690000101",
      date: "2026-11-14", time: "13:00", status: "confirmed", notes: "Drekë për dy.",
      requestKey: "seed:kuzhina-e-gurit:tavoline-2-elira",
    }));
    bookings.push(await saveBooking({
      businessId: kuzhina.id, service: t6, name: "Ndërtim Dajti sh.p.k.", contact: "+35542000111",
      date: "2026-11-14", time: "19:00", status: "pending", notes: "Grup pune, 6 persona. Pa alergji të deklaruara.",
      requestKey: "seed:kuzhina-e-gurit:tavoline-6-dajti",
    }));
  }

  const orders = [];
  {
    const elira = await customerByName(nora.id, "Elira Kola");
    const arben = await customerByName(nora.id, "Arben Hoxha");
    const bluM = await productBySku(nora.id, "NORA-BLU-M");
    const xhupL = await productBySku(nora.id, "NORA-XHU-L");
    orders.push(await saveOrder({
      businessId: nora.id, customer: elira, product: bluM, status: "confirmed",
      externalId: "SEED-NORA-BLU-M", options: { size: "M", color: "e zezë" },
      notes: "Porosi e konfirmuar në dyqan, dërgesë në Tiranë.",
    }));
    orders.push(await saveOrder({
      businessId: nora.id, customer: arben, product: xhupL, status: "draft",
      externalId: "SEED-NORA-XHU-L", options: { size: "L", color: "kafe" },
      notes: "Draft: pret konfirmimin e masës L.",
    }));
  }
  {
    const mira = await customerByName(dhurata.id, "Mira Dervishi");
    const kupe = await productBySku(dhurata.id, "DHU-KUPE");
    const jastek = await productBySku(dhurata.id, "DHU-JAST");
    orders.push(await saveOrder({
      businessId: dhurata.id, customer: mira, product: kupe, status: "confirmed",
      externalId: "SEED-DHU-KUPE", options: { photo: "përshkrim: foto familjare", text: "Mira 2026" },
      notes: "Kupë me foto, printimi 3–5 ditë pune.",
    }));
    orders.push(await saveOrder({
      businessId: dhurata.id, customer: mira, product: jastek, status: "pending_reconciliation",
      externalId: "SEED-DHU-JAST", options: { photo: "përshkrim: portret", text: "Për gjyshen" },
      notes: "Jastëk: stafi duhet të verifikojë foton para printimit.",
    }));
  }
  {
    const gentian = await customerByName(kuzhina.id, "Gentian Leka");
    const tave = await productBySku(kuzhina.id, "GUR-TAVE");
    const qofte = await productBySku(kuzhina.id, "GUR-QOF");
    orders.push(await saveOrder({
      businessId: kuzhina.id, customer: gentian, product: tave, status: "confirmed",
      externalId: "SEED-GUR-TAVE", notes: "Ngrënie jashtë, porosi e konfirmuar.",
    }));
    orders.push(await saveOrder({
      businessId: kuzhina.id, customer: gentian, product: qofte, status: "submitted",
      externalId: "SEED-GUR-QOF", notes: "Porosi e përcjellë te kuzhina.",
    }));
  }

  const extraCustomers = [
    { business_id: promo.id, display_name: "Hidraulik Elbasan", phone: "+35554200100" },
    { business_id: promo.id, display_name: "Projekti Fier", phone: "+35534200200" },
  ];
  for (const row of extraCustomers) {
    const existing = await db.from("customers").select("id").eq("business_id", row.business_id).eq("display_name", row.display_name).maybeSingle();
    throwIf(existing.error, row.display_name);
    if (!existing.data?.id) {
      const created = await db.from("customers").insert(row);
      throwIf(created.error, row.display_name);
    }
  }

  console.log(JSON.stringify({
    bookings: bookings.map((b) => ({ id: b.id, status: b.status, starts_at: b.starts_at, service: b.service })),
    orders: orders.map((o) => ({ id: o.id, status: o.status, replay: o.replay })),
    businesses: { nora: nora.slug, dhurata: dhurata.slug, lule: lule.slug, kuzhina: kuzhina.slug, promo: promo.slug },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
