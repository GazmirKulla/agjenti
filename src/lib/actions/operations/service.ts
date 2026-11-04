import { prepareCommunicationConfiguration, saveCommunicationConfiguration } from "@/lib/agents/communication-configuration";
import { prepareProductRemoval, executeProductRemoval, type RemovalRow } from "@/lib/products/removal";
import { OperationError } from "./error";
import { saveBusinessService } from "@/lib/services/commands";
import { saveKnowledgeEntry, createKnowledgeEntry } from "@/lib/knowledge/commands";
import { serviceColumns, parseService } from "@/lib/services/model";
import { parseProductForm } from "@/lib/products/parse";
import { setBusinessAutoReply } from "@/lib/agents/auto-reply";
import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { operationActor } from "./access";
import { fieldLabel, previewValue } from "./preview";
import { operationCatalog, parseOperation, type OperationInput, type OperationKey } from "./catalog";
import { changeProductLifecycle } from "@/lib/products/lifecycle";
import { productCatalogColumns } from "@/lib/products/catalog";
import { createProduct, updateProduct, bulkConfigureProducts } from "@/lib/products/commands";
import { updateCatalogField } from "@/lib/products/field-command";
import { prepareManagedAgent, saveManagedAgent } from "@/lib/agents/manage";
import { prepareCalendarConfiguration, saveCalendarConfiguration } from "@/lib/calendar/configuration";
import { syncBooking } from "@/lib/calendar/google";
import type { CommandActor } from "@/lib/actions/command-actor";
import { saveAgentTraining, changeAgentTraining } from "@/lib/agents/training/commands";
import { validateTrainingInput, type TrainingInput } from "@/lib/agents/training/model";
import { submitConfirmedOrder, reconcileOrder } from "@/lib/orders/submission";
import { resumeConversation, stopConversation } from "@/lib/conversations/control";
import { uuid } from "@/lib/calendar/model";
import type { Preview } from "@/lib/business-assistant/model";

export type PreparedOperation = {
  version: 1; key: OperationKey; input: OperationInput; snapshot: Record<string, unknown>;
  requestId: string; preview: Preview;
};
async function record(businessId: string, table: string, id: unknown, columns: string) {
  if (!uuid(id)) throw Error("Zgjidh një element konkret nga rezultatet e kërkimit.");
  const result = await createServiceSupabase().from(table).select(columns).eq("business_id", businessId).eq("id", id).returns<Record<string, unknown>[]>().maybeSingle();
  if (result.error || !result.data) throw Error("Elementi nuk u gjet në këtë biznes.");
  return result.data;
}
function checked(result: { error?: string; success?: unknown }) {
  if (result.error) throw Error(result.error);
  if (!result.success) throw Error("Rezultati nuk u konfirmua. Kontrollo gjendjen para riprovimit.");
}
export async function prepareOperation(businessId: string, userId: string, key: unknown, raw: unknown, accessToken?: string): Promise<PreparedOperation> {
  const actor = await operationActor(businessId, userId, accessToken);
  const { key: operation, input } = parseOperation(key, raw);
  let snapshot: Record<string, unknown> = {};
  let subject = actor.business.name;
  if (operation.startsWith("product.") && operation !== "product.field" && actor.business.catalog_source === "external") throw new OperationError("Ky katalog menaxhohet nga burimi i jashtëm.");
  if (operation === "product.remove") {
    const batch = await prepareProductRemoval(businessId, userId, input);
    return { version: 1, key: operation, input: { scope: "ids", ids: batch.rows.map(row => row.id) },
      snapshot: { rows: batch.rows }, requestId: randomUUID(), preview: batch.preview };
  }
  if (["product.delete", "product.archive", "product.restore", "product.edit", "product.field"].includes(operation)) {
    snapshot = await record(businessId, "products", input.id, productCatalogColumns);
    subject = String(snapshot.name);
    if (operation === "product.delete") {
      const batch = await prepareProductRemoval(businessId, userId, { scope: "ids", ids: [input.id] });
      if (batch.rows[0].operation === "archive") throw new OperationError("Produkti ka histori të lidhur dhe nuk mund të fshihet. Përgatit arkivimin për shqyrtim.");
      if (Date.parse(batch.rows[0].updated_at) !== Date.parse(String(snapshot.updated_at))) throw new OperationError("Produkti ndryshoi gjatë përgatitjes. Rishqyrtoje.");
    }
    if (["product.edit", "product.field"].includes(operation) && snapshot.archived_at) throw Error("Rikthe fillimisht produktin e arkivuar.");
    if (operation === "product.field" && !["workflow_id", "product_type_id", "is_active"].includes(String(input.field))) throw Error("Fushë e pavlefshme e produktit.");
  } else if (operation === "knowledge.save") {
    if (input.id) snapshot = await record(businessId, "knowledge_entries", input.id, "id,title,body,is_active,intent_key,updated_at");
    const values = { ...snapshot, ...input };
    if (typeof values.title !== "string" || !values.title.trim() || values.title.length > 8000 || typeof values.body !== "string" || !values.body.trim() || values.body.length > 8000 || values.is_active !== undefined && typeof values.is_active !== "boolean") throw Error("Plotëso titullin dhe përmbajtjen e njohurisë.");
    if (input.id && input.intent_key !== undefined && input.intent_key !== snapshot.intent_key) throw Error("Identifikuesi i njohurisë ekzistuese ruhet i pandryshuar.");
    subject = values.title;
  } else if (operation === "product.create") {
    const parsed = parseProductForm(productForm(input));
    if ("error" in parsed) throw Error(parsed.error);
    subject = parsed.name;
  } else if (operation === "service.save") {
    if (input.id) snapshot = await record(businessId, "booking_services", input.id, serviceColumns);
    const parsed = parseService(serviceForm({ is_active: false, booking_enabled: false, ...snapshot, ...input }));
    subject = parsed.name;
  } else if (operation === "product.bulk") {
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100 || input.ids.some(id => !uuid(id)) || !["map", "activate", "draft"].includes(String(input.mode))) throw Error("Zgjidh 1–100 produkte dhe veprimin e grupit.");
    const rows = await Promise.all([...new Set(input.ids)].map(id => record(businessId, "products", id, "id,name,updated_at,archived_at")));
    if (rows.some(row => row.archived_at)) throw Error("Grupi përmban produkte të arkivuara. Riktheji përpara konfigurimit.");
    snapshot = { rows }; subject = rows.map(row => String(row.name)).join(", ");
  } else if (operation === "calendar.settings") snapshot = await prepareCalendarConfiguration(businessId, input);
  else if (operation === "agent.communication") {
    snapshot = await prepareCommunicationConfiguration(businessId, input);
    subject = String((snapshot.before as Record<string, unknown>).name);
  } else if (operation === "agent.manage") {
    snapshot = await prepareManagedAgent(businessId, input);
    subject = String((snapshot.values as Record<string, unknown>).name);
  } else if (operation === "booking.sync") snapshot = await record(businessId, "bookings", input.id, "id,customer_name,revision,sync_status");
  else if (operation === "training.save") {
    validateTrainingInput(input as TrainingInput);
    if (input.id) snapshot = await record(businessId, "agent_training_memories", input.id, "id,instruction,revision");
  } else if (operation === "training.change") {
    if (!["enable", "disable", "delete"].includes(String(input.action))) throw Error("Zgjidh aktivizim, çaktivizim ose fshirje të mësimit.");
    snapshot = await record(businessId, "agent_training_memories", input.id, "id,instruction,revision");
    if (input.revision !== snapshot.revision) throw Error("Mësimi ndryshoi. Rishqyrtoje.");
  } else if (operation === "attention.configure") {
    if (typeof input.enabled !== "boolean") throw Error("Specifiko Po ose Jo për njoftimet.");
    const current = await createServiceSupabase().from("business_attention_preferences").select("enabled").eq("business_id", businessId).eq("user_id", userId).maybeSingle();
    if (current.error) throw Error("Preferenca nuk u lexua.");
    snapshot = { enabled: current.data?.enabled ?? false };
  } else if (operation === "business.autoreply") {
    if (typeof input.enabled !== "boolean") throw Error("Specifiko Po ose Jo për përgjigjet automatike.");
    snapshot = { auto_reply: actor.business.auto_reply };
  } else if (operation.startsWith("conversation.") || operation.startsWith("order.")) {
    const id = input.id ?? input.conversationId;
    snapshot = await record(businessId, "conversations", id, "id,status,auto_reply,updated_at,participant_display_name");
    const state = await createServiceSupabase().from("conversation_states").select("revision").eq("business_id", businessId).eq("conversation_id", id).maybeSingle();
    if (state.error || !state.data) throw Error("Gjendja e bisedës nuk u verifikua.");
    snapshot.stateRevision = state.data.revision;
    subject = String(snapshot.participant_display_name ?? id);
  }
  const previewInput = operation === "product.field" ? { [String(input.field)]: input.value } : input;
  const previous = operation === "calendar.settings" || operation === "agent.manage" ? (snapshot.before ?? {}) as Record<string, unknown> : operation === "business.autoreply" ? { enabled: snapshot.auto_reply } : snapshot;
  const preview: Preview = { title: operationCatalog[operation].title, subject,
    fields: Object.entries(previewInput).filter(([field]) => !["id", "ids", "conversationId", "orderId", "revision"].includes(field)).map(([field, value]) => ({ label: fieldLabel(field), before: previewValue(previous[field]), after: previewValue(value) })),
    notice: operation === "product.delete" ? "Fshirja është përfundimtare. Produktet me histori ose lidhje ruhen përmes arkivimit."
      : operation === "agent.manage" && (snapshot.values as Record<string, unknown>).is_active ? `Agjenti aktiv zëvendësohet. Aktualisht: ${(snapshot.activeNames as string[]).join(", ") || "asnjë"}.`
      : operation === "product.restore" ? "Produkti rikthehet si draft joaktiv." : undefined };
  if (operation === "agent.communication") {
    const current = snapshot.before as Record<string, unknown>;
    const proposed = snapshot.preview as Record<string, unknown> | null;
    preview.fields = proposed ? Object.entries(proposed).filter(([key]) => key !== "baseRevision").map(([key, value]) => ({ label: fieldLabel(key), before: previewValue(current[key]), after: previewValue(value) })) : preview.fields;
    preview.notice = input.mode === "publish" ? "Publikon draftin e shfaqur për përgjigjet e reja. Nuk aktivizon një agjent joaktiv dhe nuk lejon veprime të reja."
      : "Ky veprim nuk ndryshon përgjigjet live. Publikimi kërkohet veçmas.";
  }
  if (!preview.fields.length) preview.fields.push({ label: "Veprimi", before: "—", after: preview.title });
  return { version: 1, key: operation, input, snapshot, requestId: randomUUID(), preview };
}
function productForm(values: Record<string, unknown>) {
  const form = new FormData();
  for (const field of ["name", "description", "sku", "image_url", "currency", "product_type_id", "workflow_id"]) form.set(field, String(values[field] ?? (field === "currency" ? "ALL" : "")));
  form.set("price", String(values.price_amount ?? ""));
  if (values.is_active === true) form.set("is_active", "on");
  else if (values.is_active !== undefined && typeof values.is_active !== "boolean") throw Error("Gjendja e produktit nuk është e vlefshme.");
  return form;
}
function serviceForm(values: Record<string, unknown>) {
  const form = new FormData();
  const defaults = { duration_minutes: 30, buffer_minutes: 0, price_mode: "request", currency: "EUR", ...values };
  for (const [field, source] of Object.entries({ name: "name", description: "description", category: "category", price: "price_amount", currency: "currency", priceMode: "price_mode", duration: "duration_minutes", buffer: "buffer_minutes" }))
    form.set(field, String(defaults[source as keyof typeof defaults] ?? ""));
  if (values.is_active === true) form.set("active", "on");
  if (values.booking_enabled === true) form.set("bookingEnabled", "on");
  for (const key of ["is_active", "booking_enabled"]) if (values[key] !== undefined && typeof values[key] !== "boolean") throw Error("Gjendja e shërbimit nuk është e vlefshme.");
  if (values.hours) { form.set("customHours", "on"); form.set("hours", JSON.stringify(values.hours)); }
  return form;
}
async function executePreparedOperation(actor: CommandActor, prepared: PreparedOperation) {
  const businessId = actor.business.id, userId = actor.userId;
  if (prepared.version !== 1) throw Error("Versioni i propozimit nuk mbështetet.");
  const { key, input } = parseOperation(prepared.key, prepared.input);
  const before = prepared.snapshot;
  const db = createServiceSupabase();
  if (key.startsWith("product.") && key !== "product.field" && actor.business.catalog_source === "external") throw new OperationError("Ky katalog menaxhohet nga burimi i jashtëm.");
  if (key === "product.remove") return executeProductRemoval(businessId, userId, before.rows as RemovalRow[]);
  if (key === "product.delete" || key === "product.archive" || key === "product.restore") return changeProductLifecycle({ businessId, userId, id: String(input.id), expected: String(before.updated_at), operation: key.split(".")[1] as "delete" | "archive" | "restore" });
  if (key === "product.create") checked(await createProduct(actor, productForm(input)));
  else if (key === "knowledge.save") {
    const values = { is_active: true, ...before, ...input };
    const form = new FormData();
    for (const field of ["title", "body", "intent_key"]) form.set(field, String(values[field as keyof typeof values] ?? ""));
    form.set("is_active", values.is_active ? "on" : "false");
    if (input.id) { form.set("id", String(input.id)); form.set("updated_at", String(before.updated_at)); checked(await saveKnowledgeEntry(actor, form)); }
    else checked(await createKnowledgeEntry(actor, form, prepared.requestId));
  }
  else if (key === "service.save") {
    const form = serviceForm({ is_active: false, booking_enabled: false, ...before, ...input });
    if (input.id) { form.set("id", String(input.id)); form.set("updatedAt", String(before.updated_at)); }
    checked(await saveBusinessService(actor, form));
  } else if (key === "product.edit") {
    const form = productForm({ ...before, ...input });
    form.set("product_id", String(input.id)); form.set("updated_at", String(before.updated_at));
    checked(await updateProduct(actor, form));
  } else if (key === "product.field") {
    checked(await updateCatalogField(actor, { id: String(input.id), field: input.field as "workflow_id" | "product_type_id" | "is_active", value: input.value as string | boolean | null, updatedAt: String(before.updated_at) }));
  } else if (key === "product.bulk") {
    const rows = before.rows as Record<string, unknown>[];
    // The shared writer consumes these revisions atomically, including for manual batches.
    checked(await bulkConfigureProducts(actor, { ids: input.ids as string[], mode: input.mode as "map" | "activate" | "draft",
      productTypeId: (input.productTypeId as string | null) ?? null, workflowId: (input.workflowId as string | null) ?? null,
      expected: Object.fromEntries(rows.map(row => [String(row.id), String(row.updated_at)])) }));
  } else if (key === "calendar.settings") return saveCalendarConfiguration(businessId, userId, before as Awaited<ReturnType<typeof prepareCalendarConfiguration>>);
  else if (key === "agent.communication") return saveCommunicationConfiguration(businessId, userId, before as Awaited<ReturnType<typeof prepareCommunicationConfiguration>>);
  else if (key === "agent.manage") return saveManagedAgent(businessId, userId, before as Awaited<ReturnType<typeof prepareManagedAgent>>);
  else if (key === "booking.sync") {
    const current = await record(businessId, "bookings", input.id, "id,revision");
    if (current.revision !== before.revision) throw Error("Rezervimi ndryshoi. Rishqyrto sinkronizimin.");
    await syncBooking(businessId, String(input.id));
  } else if (key === "training.save") checked(await saveAgentTraining(actor, input as TrainingInput));
  else if (key === "training.change") checked(await changeAgentTraining(actor, input as { id: string; revision: number; action: "enable" | "disable" | "delete" }));
  else if (key === "attention.configure") {
    if (typeof input.enabled !== "boolean") throw Error("Preferencë e pavlefshme.");
    const saved = await db.rpc("configure_attention", { p_business: businessId, p_user: userId, p_enabled: input.enabled, p_expected: before.enabled });
    if (saved.error) throw Error("Preferenca ndryshoi ose nuk u ruajt. Rishqyrtoje.");
  } else if (key === "business.autoreply") {
    await setBusinessAutoReply(businessId, input.enabled as boolean, before.auto_reply as boolean);
  } else if (key === "conversation.resume") {
    const result = await resumeConversation(businessId, userId, String(input.id), Number(before.stateRevision));
    if ("error" in result) throw Error(result.error);
  } else if (key === "conversation.pause") {
    const result = await stopConversation(businessId, String(input.id), "pause", String(before.updated_at));
    if ("error" in result) throw Error(result.error);
  } else if (key === "order.submit") {
    const receipt = await submitConfirmedOrder({ businessId, userId, conversationId: String(input.conversationId), expectedRevision: Number(before.stateRevision) });
    return { message: `Rezultati i porosisë: ${receipt.status}.`, path: "orders" };
  } else if (key === "order.reconcile") {
    const receipt = await reconcileOrder({ businessId, userId, conversationId: String(input.conversationId), body: input });
    return { message: `Verifikimi i porosisë u regjistrua: ${receipt.status}.`, path: "orders" };
  } else {
    const exhaustive: never = key; throw Error(`Veprim pa ekzekutues: ${exhaustive}`);
  }
  return { message: "Ndryshimi u konfirmua.", path: operationCatalog[key].module };
}

/** A lost response cannot dispatch an operation twice. Running/uncertain receipts
 * require inspection; only completed receipts may be replayed as success. */
export async function executeOperation(businessId: string, userId: string, prepared: PreparedOperation, accessToken?: string) {
  const actor = await operationActor(businessId, userId, accessToken);
  parseOperation(prepared.key, prepared.input);
  const db = createServiceSupabase();
  const claim = await db.rpc("claim_business_operation", { p_id: prepared.requestId, p_business: businessId, p_user: userId, p_operation: prepared.key });
  if (claim.error || !claim.data) throw Error("Veprimi nuk u rezervua për ekzekutim.");
  if (!claim.data.execute) {
    if (claim.data.state === "completed" && claim.data.result) return claim.data.result as { message: string; path: string };
    throw Error("Ky veprim është në proces ose rezultati është i pasigurt. Kontrollo gjendjen para një propozimi tjetër.");
  }
  try {
    const result = await executePreparedOperation(actor, prepared);
    const saved = await db.from("business_operation_receipts").update({ state: "completed", result, updated_at: new Date().toISOString() })
      .eq("id", prepared.requestId).eq("business_id", businessId).eq("user_id", userId).eq("state", "running").select("id").maybeSingle();
    if (saved.error || !saved.data) throw Error("Veprimi mund të jetë kryer, por dëftesa nuk u ruajt. Kontrollo gjendjen.");
    return result;
  } catch (error) {
    await db.from("business_operation_receipts").update({ state: "uncertain", updated_at: new Date().toISOString() })
      .eq("id", prepared.requestId).eq("business_id", businessId).eq("user_id", userId).eq("state", "running");
    throw error;
  }
}
