import { ITEM_KINDS } from "@/lib/items/kinds";
import { parseBusinessFields, type BusinessField } from "@/lib/items/fields";
import { parseStockSettings, type StockSettings } from "@/lib/products/stock";
import { storeStockSettings } from "@/lib/products/stock-store";
import { describeSync, syncLinkedProducts } from "@/lib/products/linked-sync";
import { probeLinkedCatalog } from "@/lib/integrations/zana";
import { moduleRegistry } from "@/lib/dashboard/modules/registry";
import type { ModuleId } from "@/lib/dashboard/modules/types";
import { createServiceSupabase } from "@/lib/supabase/service";
import { readBusinessSettings, storeItemSetup, storeModules, storeOwnFields, storeQuestions } from "./store";

/**
 * The Assistant's confirmed operations on the business settings. Each prepares a preview of before and
 * after from the stored settings, and executes through the same writer as Cilësimet, only if the settings
 * did not change in between.
 */
export const settingsOperations = ["stock.settings", "structure.fields", "structure.questions", "structure.kind", "modules.configure", "catalog.sync", "integrations.check"] as const;
export type SettingsOperation = (typeof settingsOperations)[number];
export const isSettingsOperation = (key: string): key is SettingsOperation => (settingsOperations as readonly string[]).includes(key);

type Line = { label: string; before: string; after: string };
export class SettingsError extends Error {}

const deducts: Record<string, string> = { confirmed: "kur konfirmohet porosia", accepted: "kur porosia pranohet", manual: "vetëm dorazi" };
const displays: Record<string, string> = { availability: "vetëm “e kemi / ka mbaruar”", low: "“pak copë” kur sasia është e ulët", exact: "numri i saktë" };
const modes: Record<string, string> = { off: "nuk e ndjek stokun", tracked: "ndiq stokun", unique: "copë unike" };
const types: Record<string, string> = { text: "tekst", number: "numër", select: "listë", boolean: "po/jo", photo: "foto" };
const fieldLine = (f: BusinessField) => `${f.label} (${f.variant ? "zgjedh klienti" : types[f.type] ?? f.type}${f.options?.length ? `: ${f.options.join(", ")}` : ""}${f.unit ? `, ${f.unit}` : ""})`;
const list = (fields: BusinessField[]) => fields.length ? fields.map(fieldLine).join("; ") : "—";
const moduleName = (id: string) => (moduleRegistry as Record<string, { label?: string }>)[id]?.label ?? id;
const stockLines = (before: StockSettings, after: StockSettings): Line[] => [
  { label: "Kur ulet stoku", before: deducts[before.deduct], after: deducts[after.deduct] },
  { label: "Çfarë i thotë Agjenti klientit", before: displays[before.display], after: displays[after.display] },
  { label: "Një produkt i ri", before: modes[before.defaultMode], after: modes[after.defaultMode] },
  { label: "“Pak copë” deri në", before: String(before.lowThreshold), after: String(after.lowThreshold) },
].filter(line => line.before !== line.after);

/** What the operation will change, checked against the stored settings; the snapshot is what it expects to find. */
export async function prepareSettingsOperation(businessId: string, key: SettingsOperation, input: Record<string, unknown>) {
  const current = await readBusinessSettings(businessId);
  if (key === "stock.settings") {
    const parsed = parseStockSettings({ ...current.stock, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) });
    if ("error" in parsed) throw new SettingsError(parsed.error);
    const lines = stockLines(current.stock, parsed.settings);
    if (!lines.length) throw new SettingsError("Rregullat e stokut janë tashmë kështu.");
    return { snapshot: { stock: current.stock }, lines, subject: "Stoku" };
  }
  if (key === "structure.fields" || key === "structure.questions") {
    const raw = key === "structure.fields" ? input.fields : input.questions;
    if (!Array.isArray(raw)) throw new SettingsError(key === "structure.fields" ? "Dërgo listën e plotë të fushave." : "Dërgo listën e plotë të pyetjeve.");
    const rows = key === "structure.questions" ? raw.map(row => ({ ...(row && typeof row === "object" ? row : {}), ask: true, variant: false })) : raw;
    const others = key === "structure.fields" ? current.questions : current.fields;
    const parsed = parseBusinessFields(key === "structure.fields" ? [...rows, ...others] : [...others, ...rows]);
    if ("error" in parsed) throw new SettingsError(parsed.error);
    const next = parsed.fields.filter(f => key === "structure.fields" ? !f.ask : f.ask);
    const before = key === "structure.fields" ? current.fields : current.questions;
    return { snapshot: { fields: current.fields, questions: current.questions },
      lines: [{ label: key === "structure.fields" ? "Fushat e produkteve" : "Pyetjet për klientin", before: list(before), after: list(next) }],
      subject: key === "structure.fields" ? "Struktura e produkteve" : "Pyetjet kur porosit" };
  }
  if (key === "structure.kind") {
    const kind = String(input.kind ?? current.item.kind);
    if (!ITEM_KINDS[kind]) throw new SettingsError("Zgjidh një nga llojet: product, property, vehicle, equipment.");
    const name = (k: string) => ITEM_KINDS[k]?.plural ?? k;
    return { snapshot: { item: current.item }, subject: "Çfarë shet biznesi", lines: [
      { label: "Lloji", before: name(current.item.kind), after: name(kind) },
      { label: "Emri në menu", before: current.item.plural ?? "—", after: typeof input.plural === "string" ? input.plural : current.item.plural ?? "—" },
      { label: "Një artikull quhet", before: current.item.singular ?? "—", after: typeof input.singular === "string" ? input.singular : current.item.singular ?? "—" },
    ].filter(line => line.before !== line.after) };
  }
  if (key === "modules.configure") {
    const ids = (value: unknown) => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    const show = ids(input.show), hide = ids(input.hide);
    const unknown = [...show, ...hide].filter(id => !current.modules.available.includes(id as ModuleId));
    if (unknown.length) throw new SettingsError(`Këto seksione nuk mund të ndryshohen për këtë biznes: ${unknown.join(", ")}.`);
    const shown = [...new Set([...current.modules.shown.filter(id => !hide.includes(id)), ...show.filter(id => !hide.includes(id))])] as ModuleId[];
    return { snapshot: { modules: current.modules.shown }, subject: "Seksionet e panelit", lines: [
      { label: "Të shfaqura", before: current.modules.shown.map(moduleName).join(", ") || "—", after: shown.map(moduleName).join(", ") || "—" }], shown };
  }
  const integration = await createServiceSupabase().from("integrations").select("catalog_url,status").eq("business_id", businessId).eq("kind", "http").maybeSingle();
  if (integration.error || !integration.data?.catalog_url) throw new SettingsError("Biznesi nuk ka katalog webi të lidhur. Lidhe te Integrimet.");
  return { snapshot: {}, lines: [{ label: "Katalogu", before: integration.data.catalog_url, after: key === "catalog.sync" ? "produktet merren nga webi" : "vetëm provë, pa ndryshim" }],
    subject: new URL(integration.data.catalog_url).hostname };
}

/** Carries out a confirmed operation, refusing when the settings changed since it was prepared. */
export async function executeSettingsOperation(businessId: string, userId: string, key: SettingsOperation, input: Record<string, unknown>, snapshot: Record<string, unknown>): Promise<{ message: string; path: string }> {
  const current = await readBusinessSettings(businessId);
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  if ((snapshot.stock && changed(snapshot.stock, current.stock)) || (snapshot.fields && changed(snapshot.fields, current.fields))
    || (snapshot.questions && changed(snapshot.questions, current.questions)) || (snapshot.item && changed(snapshot.item, current.item))
    || (snapshot.modules && changed(snapshot.modules, current.modules.shown)))
    throw new SettingsError("Cilësimet ndryshuan që kur u përgatit propozimi. Kërkoje përsëri.");
  const fail = (result: { error?: string }) => { if (result.error) throw new SettingsError(result.error); };
  if (key === "stock.settings") {
    const saved = await storeStockSettings(businessId, userId, { ...current.stock, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) });
    fail(saved as { error?: string });
    return { message: "Rregullat e stokut u ruajtën. Vlejnë për porositë dhe përgjigjet e reja.", path: "products/structure" };
  }
  if (key === "structure.fields") { fail(await storeOwnFields(businessId, userId, input.fields) as { error?: string }); return { message: "Fushat e produkteve u ruajtën.", path: "products/structure" }; }
  if (key === "structure.questions") { fail(await storeQuestions(businessId, userId, input.questions) as { error?: string }); return { message: "Pyetjet u ruajtën. Te çdo produkt zgjedh cilat bën Agjenti.", path: "agents/process" }; }
  if (key === "structure.kind") {
    const saved = await storeItemSetup(businessId, userId, { kind: input.kind ?? current.item.kind, plural: input.plural ?? current.item.plural, singular: input.singular ?? current.item.singular });
    fail(saved); return { message: ("success" in saved && saved.success) || "U ruajt.", path: "products/structure" };
  }
  if (key === "modules.configure") {
    const prepared = await prepareSettingsOperation(businessId, key, input);
    const saved = await storeModules(businessId, userId, prepared.shown ?? []);
    fail(saved); return { message: ("success" in saved && saved.success) || "U ruajt.", path: "settings/modules" };
  }
  if (key === "catalog.sync") {
    const described = describeSync(await syncLinkedProducts({ businessId, userId }));
    if (described.error && !described.success) throw new SettingsError(described.error);
    return { message: described.success ?? described.error ?? "Produktet u rifreskuan.", path: "products" };
  }
  const probe = await probeLinkedCatalog({ businessId });
  return { message: probe.ok ? "Lidhja me webin punon." : "Lidhja me webin nuk u përgjigj si duhet. Kontrolloje te Integrimet.", path: "integrations" };
}
