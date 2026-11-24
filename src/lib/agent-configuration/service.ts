import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { defaultCommunicationPolicy, parseCommunicationPolicy } from "@/lib/agents/communication-policy";
import { validateTrainingInput, type TrainingInput } from "@/lib/agents/training/model";
import { knowledgeSource } from "@/lib/knowledge/context";
import { parseProfile, ProfileError, readProfile, profileChanges } from "@/lib/business-profile/model";

/**
 * One way to change the agent's configuration: knowledge, instructions and communication, behavior, training,
 * and the two booking permissions kept in the catalog (a service's booking_enabled, the calendar's
 * agent_booking_enabled). A request becomes a proposal with its concrete parts, the version it was prepared on,
 * each object's stamp and the consequences in words; apply_agent_configuration then writes every part in one
 * transaction or none, and records one version (at most three are kept). Orders, bookings, prices, stock and
 * conversations are never part of it.
 */
export type ConfigurationRequest =
  | { type: "knowledge.save"; id?: string; title: string; body: string; is_active?: boolean; intent_key?: string | null; source?: unknown;
      /** For a new entry: its id, derived from the request so a retry creates it once. */
      newId?: string; expected?: string }
  | { type: "knowledge.active"; id: string; is_active: boolean; expected?: string }
  | { type: "knowledge.delete"; id: string; expected?: string }
  | { type: "agent.update"; id?: string; instructions?: string; communication?: Record<string, unknown>; expected?: string }
  | { type: "agent.draft"; id: string; action: "apply" | "discard"; expected?: string }
  | { type: "behavior.set"; voice?: boolean; escalation?: "handoff" | "notify" | "off" }
  | { type: "service.booking"; id: string; booking_enabled: boolean }
  | { type: "calendar.agent_booking"; enabled: boolean }
  | ({ type: "training.save" } & TrainingInput)
  | { type: "training.active"; id: string; is_active: boolean; revision?: number }
  | { type: "training.delete"; id: string; revision?: number }
  | { type: "proposal.decide"; id: string; decision: "accept" | "reject"; expected: string; title?: string; body?: string }
  /** The public profile: the whole profile from the editor, or a patch of whole sections from the Assistant. */
  | { type: "profile.set"; profile?: unknown; patch?: Partial<Record<"identity" | "contacts" | "location" | "hours", unknown>>; expected?: string };

export type ConfigurationSource = "owner" | "assistant" | "sources" | "conversations" | "memory";
export type PreviewLine = { label: string; before: string; after: string };
export type PreparedConfiguration = {
  baseRevision: number | null;
  /** The parts exactly as the database will check and write them (ids and stamps resolved). */
  changes: Record<string, unknown>[];
  lines: PreviewLine[];
  summary: string;
};

export class ConfigurationError extends Error {
  constructor(message: string, readonly code: "invalid" | "stale" | "missing" | "unavailable" = "invalid") { super(message); }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
const short = (value: unknown, max = 160) => {
  const text = typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || "—";
};
/** The same database stamp, written with or without microseconds/offset. */
const sameStamp = (a: string, b: string) => a === b || (Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b));
const onOff = (value: unknown) => value === true ? "Po" : value === false ? "Jo" : "—";
const escalationWords: Record<string, string> = { handoff: "Ia kalon stafit", notify: "Vetëm njofton stafin", off: "Asgjë" };

async function row<T>(table: string, businessId: string, id: unknown, columns: string): Promise<T> {
  if (!isId(id)) throw new ConfigurationError("Zgjidh një element konkret.");
  const { data, error } = await createServiceSupabase().from(table).select(columns).eq("business_id", businessId).eq("id", id).maybeSingle();
  if (error) throw new ConfigurationError("Konfigurimi nuk u lexua. Provo përsëri.", "unavailable");
  if (!data) throw new ConfigurationError("Elementi nuk u gjet në këtë biznes.", "missing");
  return data as T;
}

export async function currentConfigurationRevision(businessId: string) {
  const { data, error } = await createServiceSupabase().from("agent_configuration_snapshots").select("revision")
    .eq("business_id", businessId).order("revision", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ConfigurationError("Versioni i konfigurimit nuk u lexua.", "unavailable");
  return Number(data?.revision ?? 0);
}

async function targetAgent(businessId: string, id?: string) {
  const db = createServiceSupabase();
  if (id) return row<{ id: string; name: string; instructions: string; communication: unknown; updated_at: string; is_active: boolean; configuration_draft: unknown }>(
    "ai_agents", businessId, id, "id,name,instructions,communication,updated_at,is_active,configuration_draft");
  const { data, error } = await db.from("ai_agents").select("id,name,instructions,communication,updated_at,is_active,configuration_draft").eq("business_id", businessId)
    .order("is_active", { ascending: false }).limit(2);
  if (error) throw new ConfigurationError("Agjenti nuk u lexua.", "unavailable");
  const agent = data?.find(item => item.is_active) ?? (data?.length === 1 ? data[0] : null);
  if (!agent) throw new ConfigurationError("Zgjidh agjentin që do të ndryshosh.", "missing");
  return agent;
}

/** Reads every object a request touches, records its stamp and states each change before → after. */
export async function prepareConfiguration(businessId: string, requests: ConfigurationRequest[], options: { fence?: boolean } = {}): Promise<PreparedConfiguration> {
  if (!Array.isArray(requests) || !requests.length || requests.length > 60) throw new ConfigurationError("Ndryshimi duhet të ketë 1–60 pjesë.");
  const baseRevision = options.fence === false ? null : await currentConfigurationRevision(businessId);
  const changes: Record<string, unknown>[] = [], lines: PreviewLine[] = [];
  for (const request of requests) {
    if (!request || typeof request !== "object") throw new ConfigurationError("Pjesë e pavlefshme e ndryshimit.");
    switch (request.type) {
      case "knowledge.save": {
        const title = typeof request.title === "string" ? request.title.trim() : "", body = typeof request.body === "string" ? request.body.trim() : "";
        if (!title || !body || title.length > 8000 || body.length > 8000) throw new ConfigurationError("Plotëso titullin dhe përmbajtjen e njohurisë (deri në 8000 karaktere).");
        if (request.is_active !== undefined && typeof request.is_active !== "boolean") throw new ConfigurationError("Zgjidh nëse njohuria përdoret nga Agjenti.");
        if (request.intent_key === "service") throw new ConfigurationError("Njohuritë e shërbimeve ndryshohen te Shërbimet.");
        if (request.id) {
          const before = await row<{ id: string; title: string; body: string; is_active: boolean; intent_key: string | null; updated_at: string }>("knowledge_entries", businessId, request.id, "id,title,body,is_active,intent_key,updated_at");
          if (before.intent_key === "service") throw new ConfigurationError("Njohuritë e shërbimeve ndryshohen te Shërbimet.");
          if (request.expected && !sameStamp(request.expected, before.updated_at)) throw new ConfigurationError("Njohuria ndryshoi ose u hoq. Rifresko faqen përpara ruajtjes.", "stale");
          changes.push({ type: "knowledge.save", id: before.id, title, body, ...(request.is_active !== undefined ? { is_active: request.is_active } : {}), expected: request.expected ?? before.updated_at, owner: true });
          if (before.title !== title) lines.push({ label: `Njohuria “${short(before.title, 60)}” · titulli`, before: short(before.title), after: short(title) });
          if (before.body !== body) lines.push({ label: `Njohuria “${short(title, 60)}”`, before: short(before.body), after: short(body) });
          if (request.is_active !== undefined && request.is_active !== before.is_active) lines.push({ label: `Njohuria “${short(title, 60)}” · përdoret nga Agjenti`, before: onOff(before.is_active), after: onOff(request.is_active) });
        } else {
          if (request.newId !== undefined && !isId(request.newId)) throw new ConfigurationError("Identiteti i njohurisë nuk është i vlefshëm.");
          changes.push({ type: "knowledge.save", id: request.newId ?? randomUUID(), title, body, is_active: request.is_active ?? true, intent_key: request.intent_key ?? null,
            source: request.source ?? knowledgeSource("owner") });
          lines.push({ label: "Njohuri e re", before: "—", after: `${short(title, 60)}: ${short(body)}${request.is_active === false ? " (e fikur)" : ""}` });
        }
        break;
      }
      case "knowledge.active": {
        if (typeof request.is_active !== "boolean") throw new ConfigurationError("Zgjidh ndezur ose fikur.");
        const before = await row<{ id: string; title: string; is_active: boolean; intent_key: string | null; updated_at: string }>("knowledge_entries", businessId, request.id, "id,title,is_active,intent_key,updated_at");
        if (before.intent_key === "service") throw new ConfigurationError("Njohuritë e shërbimeve ndryshohen te Shërbimet.");
        if (request.expected && !sameStamp(request.expected, before.updated_at)) throw new ConfigurationError("Njohuria ndryshoi ose u hoq. Rifresko faqen.", "stale");
        changes.push({ type: "knowledge.active", id: before.id, is_active: request.is_active, expected: request.expected ?? before.updated_at });
        lines.push({ label: `Njohuria “${short(before.title, 60)}” · përdoret nga Agjenti`, before: onOff(before.is_active), after: onOff(request.is_active) });
        break;
      }
      case "knowledge.delete": {
        const before = await row<{ id: string; title: string; intent_key: string | null; updated_at: string }>("knowledge_entries", businessId, request.id, "id,title,intent_key,updated_at");
        if (before.intent_key === "service") throw new ConfigurationError("Njohuritë e shërbimeve ndryshohen te Shërbimet.");
        if (request.expected && !sameStamp(request.expected, before.updated_at)) throw new ConfigurationError("Njohuria ndryshoi ose u hoq. Rifresko faqen.", "stale");
        changes.push({ type: "knowledge.delete", id: before.id, expected: request.expected ?? before.updated_at });
        lines.push({ label: "Njohuri që hiqet", before: short(before.title), after: "—" });
        break;
      }
      case "agent.update": {
        const agent = await targetAgent(businessId, request.id);
        if (request.instructions !== undefined && (typeof request.instructions !== "string" || !request.instructions.trim() || request.instructions.length > 8000))
          throw new ConfigurationError("Plotëso udhëzimet e agjentit (deri në 8000 karaktere).");
        if (request.communication !== undefined && (!request.communication || typeof request.communication !== "object" || Array.isArray(request.communication)))
          throw new ConfigurationError("Mënyra e komunikimit nuk është e vlefshme.");
        let current: ReturnType<typeof parseCommunicationPolicy>;
        try { current = parseCommunicationPolicy(agent.communication); } catch { current = { ...defaultCommunicationPolicy }; }
        let communication: ReturnType<typeof parseCommunicationPolicy>;
        try { communication = parseCommunicationPolicy({ ...current, ...(request.communication ?? {}) }); } catch (error) { throw new ConfigurationError(error instanceof Error ? error.message : "Mënyra e komunikimit nuk është e vlefshme."); }
        if (request.expected && !sameStamp(request.expected, agent.updated_at)) throw new ConfigurationError("Udhëzimet ndryshuan ndërkohë. Rifresko dhe rishqyrtoji.", "stale");
        const instructions = request.instructions?.trim() ?? agent.instructions;
        changes.push({ type: "agent.update", id: agent.id, instructions, communication, expected: request.expected ?? agent.updated_at });
        if (instructions !== agent.instructions) lines.push({ label: `Udhëzimet e ${agent.name}`, before: short(agent.instructions, 400), after: short(instructions, 400) });
        for (const [key, value] of Object.entries(communication)) {
          const was = (current as Record<string, unknown>)[key];
          if (JSON.stringify(was) !== JSON.stringify(value)) lines.push({ label: `Komunikimi · ${key}`, before: short(was), after: short(value) });
        }
        break;
      }
      case "agent.draft": {
        if (request.action !== "apply" && request.action !== "discard") throw new ConfigurationError("Zgjidh Zbato ose Hidh poshtë.");
        const agent = await targetAgent(businessId, request.id);
        if (!agent.configuration_draft) throw new ConfigurationError("Nuk ka më ndryshime në pritje. Rifresko faqen.", "stale");
        if (request.expected && !sameStamp(request.expected, agent.updated_at)) throw new ConfigurationError("Udhëzimet ndryshuan ndërkohë. Rifresko faqen.", "stale");
        changes.push({ type: "agent.draft", id: agent.id, action: request.action, expected: request.expected ?? agent.updated_at });
        lines.push({ label: `Ndryshimet në pritje te ${agent.name}`, before: "Në pritje", after: request.action === "apply" ? "Zbatohen" : "Hidhen poshtë" });
        break;
      }
      case "behavior.set": {
        if (request.voice !== undefined && typeof request.voice !== "boolean") throw new ConfigurationError("Zgjidh Po ose Jo për mesazhet zanore.");
        if (request.escalation !== undefined && !["handoff", "notify", "off"].includes(request.escalation)) throw new ConfigurationError("Zgjidh: ia kalon stafit, vetëm njofton stafin, ose asgjë.");
        const { data } = await createServiceSupabase().from("businesses").select("agent_behavior").eq("id", businessId).maybeSingle();
        const before = (data?.agent_behavior ?? {}) as Record<string, unknown>;
        changes.push({ type: "behavior.set", ...(request.voice !== undefined ? { voice: request.voice } : {}), ...(request.escalation ? { escalation: request.escalation } : {}) });
        if (request.voice !== undefined) lines.push({ label: "Lexon mesazhet zanore", before: onOff(before.voice ?? true), after: onOff(request.voice) });
        if (request.escalation) lines.push({ label: "Klienti që i duhet një njeri", before: escalationWords[String(before.escalation ?? "handoff")] ?? "—", after: escalationWords[request.escalation] });
        break;
      }
      case "service.booking": {
        if (typeof request.booking_enabled !== "boolean") throw new ConfigurationError("Zgjidh nëse Agjenti merr rezervime për këtë shërbim.");
        const before = await row<{ id: string; name: string; booking_enabled: boolean; updated_at: string }>("booking_services", businessId, request.id, "id,name,booking_enabled,updated_at");
        changes.push({ type: "service.booking", id: before.id, booking_enabled: request.booking_enabled, expected: before.updated_at });
        lines.push({ label: `Shërbimi “${short(before.name, 60)}” · Agjenti merr rezervime`, before: onOff(before.booking_enabled),
          after: request.booking_enabled ? "Po" : "Jo · jep vetëm informacion; rezervimin e merr stafi" });
        break;
      }
      case "calendar.agent_booking": {
        if (typeof request.enabled !== "boolean") throw new ConfigurationError("Zgjidh nëse Agjenti merr rezervime.");
        const { data, error } = await createServiceSupabase().from("business_calendar_settings").select("agent_booking_enabled").eq("business_id", businessId).maybeSingle();
        if (error) throw new ConfigurationError("Kalendari nuk u lexua.", "unavailable");
        if (!data) throw new ConfigurationError("Cakto fillimisht orarin te Kalendari.", "missing");
        changes.push({ type: "calendar.agent_booking", enabled: request.enabled });
        lines.push({ label: "Agjenti merr rezervime në kalendar", before: onOff(data.agent_booking_enabled), after: onOff(request.enabled) });
        break;
      }
      case "training.save": {
        const { type: _type, ...input } = request;
        void _type;
        validateTrainingInput(input);
        let expected: number | undefined;
        if (input.id) expected = (await row<{ revision: number }>("agent_training_memories", businessId, input.id, "revision")).revision;
        if (input.id && input.revision !== undefined && input.revision !== expected) throw new ConfigurationError("Ky mësim është ndryshuar. Rifresko listën.", "stale");
        changes.push({ type: "training.save", id: input.id ?? randomUUID(), kind: input.kind, instruction: input.instruction.trim(),
          customer_message: input.kind === "example" ? input.customerMessage?.trim() ?? "" : "", desired_response: input.kind === "example" ? input.desiredResponse?.trim() ?? "" : "",
          workflow_id: input.workflowId ?? null, step_key: input.stepKey ?? null, visual_flow_id: input.visualFlowId ?? null, visual_node_id: input.visualNodeId ?? null,
          ...(input.id ? { expected_revision: expected } : { source: input.receipt ? "test_feedback" : "manual" }) });
        lines.push({ label: input.kind === "example" ? "Shembull përgjigjeje" : input.kind === "workflow" ? "Mësim për procesin" : "Preferencë stili", before: input.id ? "Mësim ekzistues" : "—", after: short(input.instruction) });
        break;
      }
      case "training.active":
      case "training.delete": {
        const before = await row<{ id: string; instruction: string; revision: number; is_active: boolean }>("agent_training_memories", businessId, request.id, "id,instruction,revision,is_active");
        if (request.revision !== undefined && request.revision !== before.revision) throw new ConfigurationError("Ky mësim është ndryshuar ose është hequr. Rifresko listën.", "stale");
        if (request.type === "training.active") {
          if (typeof request.is_active !== "boolean") throw new ConfigurationError("Zgjidh aktiv ose joaktiv.");
          changes.push({ type: "training.active", id: before.id, is_active: request.is_active, expected_revision: before.revision });
          lines.push({ label: `Mësimi “${short(before.instruction, 60)}”`, before: before.is_active ? "Aktiv" : "Joaktiv", after: request.is_active ? "Aktiv" : "Joaktiv" });
        } else {
          changes.push({ type: "training.delete", id: before.id, expected_revision: before.revision });
          lines.push({ label: "Mësim që hiqet", before: short(before.instruction), after: "—" });
        }
        break;
      }
      case "proposal.decide": {
        if (request.decision !== "accept" && request.decision !== "reject") throw new ConfigurationError("Zgjidh Prano ose Refuzo.");
        if (!Number.isFinite(Date.parse(request.expected))) throw new ConfigurationError("Propozimi nuk është i vlefshëm. Rifresko faqen.", "stale");
        const before = await row<{ id: string; title: string; body: string }>("knowledge_entries", businessId, request.id, "id,title,body");
        changes.push({ type: "proposal.decide", id: before.id, decision: request.decision, expected: request.expected,
          ...(request.decision === "accept" && request.title !== undefined ? { title: request.title } : {}), ...(request.decision === "accept" && request.body !== undefined ? { body: request.body } : {}) });
        lines.push({ label: `Propozim nga burimet: “${short(request.title ?? before.title, 60)}”`, before: "Në pritje", after: request.decision === "accept" ? "Pranohet dhe përdoret nga Agjenti" : "Refuzohet dhe hiqet" });
        break;
      }
      case "profile.set": {
        const { data, error } = await createServiceSupabase().from("businesses").select("public_profile,public_profile_updated_at").eq("id", businessId).maybeSingle();
        if (error || !data) throw new ConfigurationError("Profili nuk u lexua.", "unavailable");
        if (request.expected && !sameStamp(request.expected, data.public_profile_updated_at)) throw new ConfigurationError("Profili ndryshoi ndërkohë. Rifresko dhe rishqyrtoje.", "stale");
        const before = readProfile(data.public_profile);
        const patch = request.patch && typeof request.patch === "object" ? request.patch : null;
        if (!patch && request.profile === undefined) throw new ConfigurationError("Profili mungon.");
        let profile;
        try { profile = parseProfile(patch ? { ...before, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ["identity", "contacts", "location", "hours"].includes(key))) } : request.profile); }
        catch (error) { throw new ConfigurationError(error instanceof ProfileError ? error.message : "Profili nuk është i vlefshëm."); }
        changes.push({ type: "profile.set", profile, expected: request.expected ?? data.public_profile_updated_at });
        lines.push(...profileChanges(before, profile));
        break;
      }
      default: throw new ConfigurationError("Pjesë e panjohur e ndryshimit.");
    }
  }
  // "Profili: Adresa, Orari · Njohuria …": the profile's fields under one name.
  const profile = lines.filter(line => line.label.startsWith("Profili · ")).map(line => line.label.slice("Profili · ".length));
  const labels = [...(profile.length ? [`Profili: ${profile.join(", ")}`] : []), ...lines.filter(line => !line.label.startsWith("Profili · ")).map(line => line.label)];
  return { baseRevision, changes, lines, summary: labels.slice(0, 6).join(" · ").slice(0, 600) };
}

const errorMessages: Record<string, [string, ConfigurationError["code"]]> = {
  stale_configuration: ["Konfigurimi ndryshoi pasi u përgatit ky propozim. Asgjë nuk u zbatua; rishqyrtoje.", "stale"],
  stale_configuration_target: ["Një element ndryshoi ndërkohë. Asgjë nuk u zbatua; rifresko dhe rishqyrtoje.", "stale"],
  stale_agent_draft: ["Udhëzimet u ndryshuan pas këtyre ndryshimeve në pritje; nuk zbatohen dot siç janë.", "stale"],
  configuration_target_missing: ["Një element i propozimit nuk ekziston më në këtë biznes. Asgjë nuk u zbatua.", "missing"],
  configuration_version_missing: ["Ky version nuk ruhet më (mbahen vetëm tre). Asgjë nuk u ndryshua.", "missing"],
  configuration_version_current: ["Ky version është tashmë në përdorim.", "invalid"],
  calendar_missing: ["Cakto fillimisht orarin te Kalendari. Asgjë nuk u zbatua.", "missing"],
  proposal_not_pending: ["Ky propozim nuk është më në pritje. Rifresko faqen.", "stale"],
  configuration_request_conflict: ["Kjo kërkesë u përdor për një ndryshim tjetër. Përgatite përsëri.", "invalid"],
  unauthorized: ["Nuk ke qasje për të ndryshuar këtë biznes.", "invalid"],
  training_memory_limit: ["Ky biznes ka arritur 200 mësime. Hiq një mësim përpara se të shtosh tjetër.", "invalid"],
  training_workflow_tenant: ["Procesi i një mësimi nuk ekziston më. Asgjë nuk u zbatua.", "missing"],
  training_step_missing: ["Hapi i një mësimi nuk ekziston më. Asgjë nuk u zbatua.", "missing"],
  invalid_configuration_change: ["Një pjesë e ndryshimit nuk është e vlefshme. Asgjë nuk u zbatua.", "invalid"],
};
function databaseError(error: { message?: string; code?: string }): never {
  // The most specific code wins (stale_configuration_target before stale_configuration).
  const known = Object.entries(errorMessages).sort(([a], [b]) => b.length - a.length).find(([key]) => error.message?.includes(key));
  if (known) throw new ConfigurationError(known[1][0], known[1][1]);
  if (error.code === "23503") throw new ConfigurationError("Kjo njohuri është e lidhur me një shërbim dhe nuk mund të fshihet. Asgjë nuk u zbatua.", "invalid");
  throw new ConfigurationError("Ndryshimi nuk u zbatua. Asgjë nuk u ruajt pjesërisht; provo përsëri.", "unavailable");
}

export type ConfigurationReceipt = { revision: number; created: boolean; replayed: boolean; message: string; lines: PreviewLine[] };

/** Applies a prepared proposal as one whole. The same requestId after a lost response returns the first result. */
export async function applyConfiguration(businessId: string, userId: string, prepared: PreparedConfiguration, requestId: string, source: ConfigurationSource): Promise<ConfigurationReceipt> {
  if (!isId(requestId)) throw new ConfigurationError("Kërkesa nuk ka identitet të vlefshëm.");
  const { data, error } = await createServiceSupabase().rpc("apply_agent_configuration", {
    p_business: businessId, p_user: userId, p_request: requestId, p_base: prepared.baseRevision, p_changes: prepared.changes,
    p_source: source, p_summary: prepared.summary,
  });
  if (error) databaseError(error);
  if (!data || !Number.isInteger(data.revision)) throw new ConfigurationError("Rezultati nuk u konfirmua. Kontrollo historikun para riprovimit.", "unavailable");
  const created = data.created === true;
  return { revision: data.revision, created, replayed: data.replayed === true, lines: prepared.lines,
    message: created ? `U zbatua${prepared.summary ? `: ${prepared.summary}` : ""}. Versioni ${data.revision}.` : "Nuk kishte asgjë për të ndryshuar." };
}

/** Prepare and apply in one call, for a manual form whose Ruaj is the owner's confirmation. */
export async function saveConfiguration(businessId: string, userId: string, requests: ConfigurationRequest[], source: ConfigurationSource = "owner", requestId: string = randomUUID()) {
  const prepared = await prepareConfiguration(businessId, requests, { fence: false });
  return applyConfiguration(businessId, userId, prepared, requestId, source);
}

export async function revertConfiguration(businessId: string, userId: string, revision: number, baseRevision: number, requestId: string = randomUUID()) {
  if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(baseRevision)) throw new ConfigurationError("Zgjidh versionin që dëshiron të rikthesh.");
  const { data, error } = await createServiceSupabase().rpc("revert_agent_configuration", {
    p_business: businessId, p_user: userId, p_request: requestId, p_base: baseRevision, p_revision: revision,
  });
  if (error) databaseError(error);
  if (!data || !Number.isInteger(data.revision)) throw new ConfigurationError("Rezultati nuk u konfirmua. Kontrollo historikun para riprovimit.", "unavailable");
  return { revision: data.revision as number, message: data.created === false
    ? `Konfigurimi që përdor Agjenti është tashmë si versioni ${revision}; asgjë nuk ndryshoi.`
    : `U zbatua: u rikthye versioni ${revision}, tani në përdorim si versioni ${data.revision}.` };
}

export type ConfigurationVersion = { revision: number; source: string; summary: string; created_at: string; current: boolean };
export async function listConfigurationVersions(businessId: string): Promise<ConfigurationVersion[]> {
  const { data, error } = await createServiceSupabase().from("agent_configuration_snapshots").select("revision,source,summary,created_at")
    .eq("business_id", businessId).order("revision", { ascending: false }).limit(3);
  if (error) throw new ConfigurationError("Historiku nuk u ngarkua.", "unavailable");
  return (data ?? []).map((version, index) => ({ ...version, current: index === 0 }));
}
