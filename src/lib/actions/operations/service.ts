import { loadSetupStatus } from "@/lib/setup/status";
import { loadAgentBehavior } from "@/lib/agents/behavior";
import { executeSettingsOperation, isSettingsOperation, prepareSettingsOperation } from "@/lib/settings/operations";
import { after } from "next/server";
import { businessSources, refreshBusinessSources } from "@/lib/knowledge/source-refresh";
import { workerOrigin } from "@/lib/discovery/continue";
import { startInbox } from "@/lib/conversation-training/sessions";
import { continueTraining } from "@/lib/conversation-training/continue";
import { customProcessRefusal } from "@/lib/business-assistant/custom-process-policy";
import { setupGateMessage } from "@/lib/setup/model";
import { executeAgentTestTurn } from "@/lib/agents/test-chat/execute-turn";
import { createIsolatedExecution, runWithExecution } from "@/lib/runtime/execution-context";
import { loadAllowedModules } from "@/lib/dashboard/modules/entitlements";
import { prepareWorkflow, executeWorkflow } from "@/lib/business-assistant/workflow-service";
import { decryptSecret } from "@/lib/crypto/tokens";
import type { Ticket } from "@/lib/business-assistant/service";
import { prepareCommunicationConfiguration } from "@/lib/agents/communication-configuration";
import { prepareProductRemoval, executeProductRemoval, type RemovalRow } from "@/lib/products/removal";
import { OperationError } from "./error";
import { saveBusinessService } from "@/lib/services/commands";
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
import { validateTrainingInput, type TrainingInput } from "@/lib/agents/training/model";
import { submitConfirmedOrder, reconcileOrder } from "@/lib/orders/submission";
import { resumeConversation, stopConversation } from "@/lib/conversations/control";
import { uuid } from "@/lib/calendar/model";
import type { Preview } from "@/lib/business-assistant/model";
import { applyConfiguration, ConfigurationError, listConfigurationVersions, prepareConfiguration, revertConfiguration,
  type ConfigurationRequest, type PreparedConfiguration } from "@/lib/agent-configuration/service";

/** Operations that change the agent's configuration: prepared into one proposal and applied as one whole. */
const configurationKeys = new Set(["agent.configure", "knowledge.save", "knowledge.delete", "agent.communication", "agent.behavior", "training.save", "training.change"]);
const assistantParts = new Set(["knowledge.save", "knowledge.active", "knowledge.delete", "agent.update", "agent.draft", "behavior.set", "service.booking", "calendar.agent_booking", "training.save", "training.active", "training.delete"]);
const configurationNotice = "Pas konfirmimit zbatohen të gjitha bashkë dhe ruhen si një version i ri; nëse një pjesë nuk zbatohet dot, nuk zbatohet asnjë. Rezervimet, porositë dhe bisedat ekzistuese nuk ndryshojnë. Mund ta rikthesh nga Historiku.";
function configurationRequests(operation: string, input: OperationInput, snapshot: Record<string, unknown>, requestId: string): ConfigurationRequest[] {
  if (operation === "agent.configure") {
    if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 60) throw new OperationError("Ndryshimi duhet të ketë 1–60 pjesë.", "invalid_input");
    for (const part of input.changes) if (!part || typeof part !== "object" || !assistantParts.has(String((part as { type?: unknown }).type))) throw new OperationError("Pjesë e panjohur e ndryshimit.", "invalid_input");
    return input.changes as ConfigurationRequest[];
  }
  if (operation === "knowledge.save") {
    const values = { is_active: true, ...snapshot, ...input } as Record<string, unknown>;
    return [{ type: "knowledge.save", ...(input.id ? { id: String(input.id), expected: String(snapshot.updated_at) } : { newId: requestId, intent_key: (input.intent_key as string | undefined) ?? null }),
      title: String(values.title ?? ""), body: String(values.body ?? ""), is_active: values.is_active as boolean }];
  }
  if (operation === "knowledge.delete") return [{ type: "knowledge.delete", id: String(input.id), expected: String(snapshot.updated_at) }];
  if (operation === "agent.communication") {
    const proposal = snapshot as Awaited<ReturnType<typeof prepareCommunicationConfiguration>>;
    const before = proposal.before as { id: string; updated_at: string };
    if (proposal.mode === "apply") return [{ type: "agent.update", id: before.id, instructions: String(proposal.values?.instructions), communication: proposal.values?.communication as Record<string, unknown>, expected: before.updated_at }];
    if (proposal.mode === "publish" || proposal.mode === "discard") return [{ type: "agent.draft", id: before.id, action: proposal.mode === "publish" ? "apply" : "discard", expected: before.updated_at }];
    throw new OperationError("Versionet e plota rikthehen nga Historiku (agent.restore).", "invalid_input");
  }
  if (operation === "agent.behavior") return [{ type: "behavior.set", ...(input.voice !== undefined ? { voice: input.voice as boolean } : {}), ...(input.escalation !== undefined ? { escalation: input.escalation as "handoff" | "notify" | "off" } : {}) }];
  if (operation === "training.save") return [{ type: "training.save", ...(input as TrainingInput), ...(input.id ? { revision: Number(snapshot.revision) } : {}) }];
  if (operation === "training.change") return [input.action === "delete" ? { type: "training.delete", id: String(input.id), revision: Number(input.revision) }
    : { type: "training.active", id: String(input.id), is_active: input.action === "enable", revision: Number(input.revision) }];
  throw new OperationError("Veprim konfigurimi i panjohur.");
}

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
  if (operation === "business.verify") {
    if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 8 || input.messages.some(m => typeof m !== "string" || !m.trim() || m.length > 2000)) throw new OperationError("Prova kërkon 1–8 mesazhe të vlefshme.");
  }
  if (operation === "workflow.configure") {
    const refusal = await customProcessRefusal(businessId, operation);
    if (refusal) throw new OperationError(refusal);
    if (!["draft","publish"].includes(String(input.mode)) || typeof input.request !== "string" || !input.request.trim() || input.request.length > 12000 || input.mode === "draft" && !Array.isArray(input.operations) || input.mode === "publish" && input.operations !== undefined) throw new OperationError("Konfigurim workflow i pavlefshëm.");
    const result = await prepareWorkflow({businessId,userId,accessToken,modules:await loadAllowedModules(businessId),catalogSource:actor.business.catalog_source}, {
      action: input.mode === "draft" ? "workflow_draft" : "workflow_publish", id:null, message:input.request, requestedText:input.request,
      changes: input.mode === "draft" ? [{field:"operations",value:JSON.stringify(input.operations)}] : [],
    });
    if (!result.token || !result.preview) throw new OperationError(result.message || "Workflow-i nuk kaloi kontrollet e konfigurimit.");
    snapshot = {ticket:JSON.parse(decryptSecret(result.token))};
    return {version:1,key:operation,input,snapshot,requestId:randomUUID(),preview:result.preview};
  }
  if (operation === "business.orders") {
    if (typeof input.enabled !== "boolean") throw new OperationError("Specifiko gjendjen e porosive lokale.");
    const current = await createServiceSupabase().from("business_automation_policies").select("revision,local_orders").eq("business_id",businessId).maybeSingle();
    if (current.error) throw new OperationError("Shërbimi i porosive automatike nuk është ende i disponueshëm.");
    snapshot = { revision: current.data?.revision ?? 0, enabled: current.data?.local_orders ?? false };
  }
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
      if (Date.parse(batch.rows[0].updated_at) !== Date.parse(String(snapshot.updated_at))) throw new OperationError("Produkti ndryshoi gjatë përgatitjes. Rishqyrtoje.", "stale");
    }
    if (["product.edit", "product.field"].includes(operation) && snapshot.archived_at) throw Error("Rikthe fillimisht produktin e arkivuar.");
    if (operation === "product.field" && !["workflow_id", "product_type_id", "is_active"].includes(String(input.field))) throw Error("Fushë e pavlefshme e produktit.");
  } else if (operation === "knowledge.delete") {
    snapshot = await record(businessId, "knowledge_entries", input.id, "id,title,body,updated_at");
    subject = String(snapshot.title);
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
  else if (operation === "agent.restore") {
    const versions = await listConfigurationVersions(businessId);
    const target = versions.find(version => version.revision === input.revision && !version.current);
    if (!target) throw new OperationError("Zgjidh një nga dy versionet e mëparshme që ruhen.", "invalid_input");
    snapshot = { revision: target.revision, base: versions[0]?.revision ?? 0, summary: target.summary };
    subject = `Versioni ${target.revision}`;
  } else if (operation === "agent.communication") {
    snapshot = await prepareCommunicationConfiguration(businessId, input);
    subject = String((snapshot.before as Record<string, unknown>).name);
  } else if (operation === "agent.manage") {
    snapshot = await prepareManagedAgent(businessId, input);
    subject = String((snapshot.values as Record<string, unknown>).name);
  } else if (operation === "booking.sync") snapshot = await record(businessId, "bookings", input.id, "id,customer_name,revision,sync_status");
  else if (operation === "agent.behavior") {
    if (input.voice !== undefined && typeof input.voice !== "boolean") throw new OperationError("Zgjidh Po ose Jo për mesazhet zanore.", "invalid_input");
    if (input.escalation !== undefined && !["handoff", "notify", "off"].includes(String(input.escalation))) throw new OperationError("Zgjidh: ia kalon stafit, vetëm njofton stafin, ose asgjë.", "invalid_input");
    snapshot = { ...(await loadAgentBehavior(businessId)) };
  } else if (operation === "sources.refresh") {
    const sources = await businessSources(businessId);
    if (!sources.website && !sources.instagram && !sources.connectedInstagram) throw new OperationError("Biznesi nuk ka ende burime. Shto Instagram-in ose website-in te Njohuritë.");
    snapshot = { website: sources.website, instagram: sources.instagram ?? (sources.connectedInstagram ? "i lidhur" : null) };
    subject = [sources.website, sources.instagram && `@${sources.instagram}`].filter(Boolean).join(" · ") || "Instagram i lidhur";
  } else if (operation === "conversations.learn") {
    if (input.days !== undefined && ![30, 90, 180].includes(input.days as number)) throw new OperationError("Zgjidh 30, 90 ose 180 ditët e fundit.");
    snapshot = { days: input.days ?? 90 };
    subject = `Bisedat e ${input.days ?? 90} ditëve të fundit`;
  }
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
    if (input.enabled && !actor.business.auto_reply) {
      const blocker = setupGateMessage(await loadSetupStatus(businessId));
      if (blocker) throw new OperationError(blocker);
    }
    snapshot = { auto_reply: actor.business.auto_reply };
  } else if (operation.startsWith("conversation.") || operation.startsWith("order.")) {
    const id = input.id ?? input.conversationId;
    snapshot = await record(businessId, "conversations", id, "id,status,auto_reply,updated_at,participant_display_name");
    const state = await createServiceSupabase().from("conversation_states").select("revision").eq("business_id", businessId).eq("conversation_id", id).maybeSingle();
    if (state.error || !state.data) throw Error("Gjendja e bisedës nuk u verifikua.");
    snapshot.stateRevision = state.data.revision;
    subject = String(snapshot.participant_display_name ?? id);
  }
  // Settings: the preview compares the stored settings with the proposed ones, in the owner's words.
  let settingsLines: { label: string; before: string; after: string }[] | null = null;
  if (isSettingsOperation(operation)) {
    try {
      const prepared = await prepareSettingsOperation(businessId, operation, input);
      snapshot = prepared.snapshot; subject = prepared.subject; settingsLines = prepared.lines;
    } catch (error) { throw new OperationError(error instanceof Error ? error.message : "Cilësimet nuk u verifikuan."); }
  }
  const previewInput = operation === "product.field" ? { [String(input.field)]: input.value } : input;
  const previous = operation === "calendar.settings" || operation === "agent.manage" ? (snapshot.before ?? {}) as Record<string, unknown> : operation === "business.autoreply" ? { enabled: snapshot.auto_reply } : snapshot;
  const preview: Preview = { title: operationCatalog[operation].title, subject,
    fields: Object.entries(previewInput).filter(([field]) => !["id", "ids", "conversationId", "orderId", "revision"].includes(field)).map(([field, value]) => ({ label: fieldLabel(field), before: previewValue(previous[field]), after: previewValue(value) })),
    notice: operation === "product.delete" ? "Fshirja është përfundimtare. Produktet me histori ose lidhje ruhen përmes arkivimit."
      : operation === "knowledge.delete" ? "Fshirja është përfundimtare. Kjo njohuri nuk do të përdoret më në përgjigjet e Agjentit."
      : operation === "agent.manage" && (snapshot.values as Record<string, unknown>).is_active ? `Agjenti aktiv zëvendësohet. Aktualisht: ${(snapshot.activeNames as string[]).join(", ") || "asnjë"}.`
      : operation === "product.restore" ? "Produkti rikthehet si draft joaktiv." : undefined };
  if (settingsLines) {
    preview.fields = settingsLines;
    if (operation === "modules.configure") preview.notice = "Fshehja e një seksioni e heq vetëm nga menuja: të dhënat dhe aftësitë e Agjentit nuk ndryshojnë.";
    if (operation === "integrations.check") preview.notice = "Vetëm provë: nuk ndryshon lidhjen dhe as produktet.";
  }
  const requestId = randomUUID();
  if (configurationKeys.has(operation)) {
    // The proposal the owner sees is the one applied: its parts, the version it was prepared on and every object's stamp.
    try {
      const configuration = await prepareConfiguration(businessId, configurationRequests(operation, input, snapshot, requestId),
        { fence: operation === "agent.configure" || operation === "agent.behavior" });
      snapshot = { ...snapshot, configuration };
      if (configuration.lines.length) preview.fields = configuration.lines;
      preview.configuration = true;
      const inactive = operation === "agent.communication" && (snapshot.before as Record<string, unknown>).is_active === false ? " Agjenti është joaktiv: nuk u përgjigjet klientëve derisa ta aktivizosh." : "";
      preview.notice = operation === "agent.communication" && input.mode === "discard" ? "Hedh poshtë ndryshimet në pritje. Udhëzimet në përdorim nuk ndryshojnë." : `${configurationNotice}${inactive}`;
    } catch (error) {
      if (error instanceof ConfigurationError) throw new OperationError(error.message, error.code === "stale" ? "stale" : "invalid_input");
      throw error;
    }
  }
  if (operation === "agent.restore") {
    preview.configuration = true;
    preview.fields = [{ label: "Konfigurimi i Agjentit", before: `Versioni ${String(snapshot.base)} (në përdorim)`, after: `Versioni ${String(snapshot.revision)}${snapshot.summary ? ` · ${String(snapshot.summary)}` : ""}` }];
    preview.notice = "Pas konfirmimit, njohuritë, udhëzimet, komunikimi, sjellja, mësimet dhe lejet e rezervimit bëhen si në atë version, si një version i ri. Njohuritë e shtuara më pas fiken, nuk fshihen. Rezervimet, porositë dhe bisedat nuk ndryshojnë.";
  }
  if (!preview.fields.length) preview.fields.push({ label: "Veprimi", before: "—", after: preview.title });
  return { version: 1, key: operation, input, snapshot, requestId, preview };
}
function productForm(values: Record<string, unknown>) {
  const form = new FormData();
  for (const field of ["name", "description", "sku", "image_url", "currency", "product_type_id", "workflow_id"]) form.set(field, String(values[field] ?? (field === "currency" ? "ALL" : "")));
  form.set("price", String(values.price_amount ?? ""));
  if (values.is_active !== undefined && typeof values.is_active !== "boolean") throw Error("Gjendja e produktit nuk është e vlefshme.");
  // A product is public or a draft, as in the editor: publishing means the agent offers it and takes orders.
  if (values.is_active === true) form.set("save_mode", "publish");
  if (values.agent_orders !== undefined) throw Error("Një produkt është publik ose draft: nuk ka më “vetëm për informim”.");
  return form;
}
export function serviceForm(values: Record<string, unknown>) {
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
  if (key === "business.verify") {
    let session: string | undefined;
    for (const message of input.messages as string[]) {
      const result = await runWithExecution(createIsolatedExecution(), () => executeAgentTestTurn({slug:actor.business.slug,message,session},userId));
      if ("error" in result) throw new OperationError(result.error);
      session = result.session ?? undefined;
      if (result.setupTestPassed) return {message:"Prova e izoluar e konfigurimit kaloi. Nuk u krijua porosi reale.",path:"agents/test"};
    }
    throw new OperationError("Prova nuk arriti rezultatin e kërkuar. Konfigurimi u ruajt, por përgjigjet automatike nuk u aktivizuan.");
  }
  if (key === "workflow.configure") {
    const ticket = before.ticket as Ticket;
    if (ticket.businessId !== businessId || ticket.userId !== userId || ticket.expires <= Date.now()) throw new OperationError("Autorizimi i workflow-t ka skaduar ose nuk përputhet.");
    const result = await executeWorkflow({businessId,userId,modules:await loadAllowedModules(businessId),catalogSource:actor.business.catalog_source},ticket);
    return {...result,path:"workflows"};
  }
  if (key === "business.orders") {
    const result = await db.rpc("configure_business_automation", {p_business:businessId,p_user:userId,p_enabled:input.enabled,p_revision:before.revision});
    if (result.error || !Number.isInteger(result.data)) throw new OperationError("Leja e porosive ndryshoi ose nuk u ruajt.", "stale");
    return {message: input.enabled ? "Regjistrimi lokal pas konfirmimit të klientit u autorizua." : "Regjistrimi automatik u çaktivizua.",path:"orders"};
  }
  if (key === "agent.restore") {
    try { return { ...(await revertConfiguration(businessId, userId, Number(before.revision), Number(before.base), prepared.requestId)), path: "agents" }; }
    catch (error) { throw error instanceof ConfigurationError ? new OperationError(error.message, error.code === "stale" ? "stale" : "invalid_input") : error; }
  }
  if (configurationKeys.has(key)) {
    const configuration = before.configuration as PreparedConfiguration | undefined;
    if (!configuration) throw new OperationError("Ky propozim u përgatit para versioneve të plota. Përgatite përsëri.", "stale");
    try {
      const source = key === "agent.configure" ? "assistant" : "owner";
      const receipt = await applyConfiguration(businessId, userId, configuration, prepared.requestId, source);
      const path = key.startsWith("knowledge") ? "knowledge" : key.startsWith("training") ? "agents/memory" : key === "agent.behavior" ? "agents/process" : "agents";
      return { message: receipt.message, path, ...(key === "knowledge.save" ? { id: input.id ? String(input.id) : prepared.requestId } : {}), revision: receipt.revision };
    } catch (error) { throw error instanceof ConfigurationError ? new OperationError(error.message, error.code === "stale" ? "stale" : "invalid_input") : error; }
  }
  if (key === "product.create") checked(await createProduct(actor, productForm(input)));
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
  else if (key === "agent.manage") return saveManagedAgent(businessId, userId, before as Awaited<ReturnType<typeof prepareManagedAgent>>);
  else if (isSettingsOperation(key)) {
    try { return await executeSettingsOperation(businessId, userId, key, input as Record<string, unknown>, before as Record<string, unknown>); }
    catch (error) { throw new OperationError(error instanceof Error ? error.message : "Ndryshimi nuk u ruajt."); }
  } else if (key === "sources.refresh") {
    const queued = await refreshBusinessSources(businessId, userId, workerOrigin(null));
    if (!queued.website && !queued.instagram) throw new OperationError("Burimet nuk u rilexuan. Provo nga Njohuritë → Nga ku mëson Agjenti.");
    return { message: "Rifreskimi nisi. Çfarë është e re ose ndryshe do të shfaqet te Njohuritë si propozim për ta shqyrtuar.", path: "knowledge" };
  } else if (key === "conversations.learn") {
    await startInbox(businessId, userId, { days: input.days ?? 90 });
    try { after(() => continueTraining(businessId, workerOrigin(null))); } catch { void continueTraining(businessId, workerOrigin(null)); }
    return { message: "Leximi i bisedave nisi. Sugjerimet do të shfaqen te Agjenti → Trajno nga bisedat, ku i shqyrton një nga një.", path: "agents/training" };
  } else if (key === "booking.sync") {
    const current = await record(businessId, "bookings", input.id, "id,revision");
    if (current.revision !== before.revision) throw Error("Rezervimi ndryshoi. Rishqyrto sinkronizimin.");
    await syncBooking(businessId, String(input.id));
  } else if (key === "attention.configure") {
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
  } else if (configurationKeys.has(key)) {
    throw Error("Veprimi i konfigurimit u trajtua më sipër.");
  } else {
    const exhaustive: never = key as never; throw Error(`Veprim pa ekzekutues: ${String(exhaustive)}`);
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
    if (claim.data.state === "completed" && claim.data.result) return claim.data.result as { message: string; path: string; id?: string };
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
