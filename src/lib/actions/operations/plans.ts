import { OperationError } from "./error";
import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { operationActor } from "./access";
import { prepareOperation, executeOperation, type PreparedOperation } from "./service";
import type { Preview } from "@/lib/business-assistant/model";

type PlanStep = { key: string; input: Record<string, unknown>; after?: number[] };
export type PreparedPlan = { id: string; fingerprint: string; steps: PreparedOperation[]; preview: Preview };
export function parsePlan(input: unknown): PlanStep[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 10) throw new OperationError("Plani duhet të ketë 2–10 hapa.");
  const targets = new Set<string>();
  return input.map((step, index) => {
    if (!step || typeof step !== "object" || Object.keys(step).some(key => !["key", "input", "after"].includes(key)) || typeof step.key !== "string" || !step.input || typeof step.input !== "object" || Array.isArray(step.input)) throw new OperationError("Hap i pavlefshëm në plan.");
    if (step.after !== undefined && (!Array.isArray(step.after) || step.after.some((n: unknown) => !Number.isInteger(n) || Number(n) < 0 || Number(n) >= index))) throw new OperationError("Varësitë e planit duhet t’u referohen hapave të mëparshëm.");
    // Merge edits to a single record before asking for approval. Two independently
    // prepared snapshots of one target would invalidate each other after step one.
    if (step.key === "product.remove" && step.input.scope !== "ids") throw new OperationError("Përgatit heqjen e katalogut si një veprim të vetëm, jashtë planit me hapa.");
    const batchIds = step.key.startsWith("product.") && Array.isArray(step.input.ids) ? step.input.ids : null;
    if (batchIds) {
      for (const id of new Set(batchIds)) {
        const target = `product:${id}`;
        if (targets.has(target)) throw new OperationError("Bashko ndryshimet për të njëjtin element në një hap.");
        targets.add(target);
      }
      return step as PlanStep;
    }
    const target = `${step.key.split(".")[0]}:${step.input.id ?? step.input.conversationId ?? (step.key.endsWith(".settings") || step.key === "business.autoreply" ? "settings" : index)}`;
    if (targets.has(target)) throw new OperationError("Bashko ndryshimet për të njëjtin element në një hap.");
    targets.add(target);
    return step as PlanStep;
  });
}
export async function prepareOperationPlan(businessId: string, userId: string, raw: unknown, accessToken?: string): Promise<PreparedPlan> {
  await operationActor(businessId, userId, accessToken);
  const requested = parsePlan(raw);
  const steps: PreparedOperation[] = [];
  for (const step of requested) steps.push(await prepareOperation(businessId, userId, step.key, step.input, accessToken));
  if (JSON.stringify(steps).length > 90000) throw new OperationError("Plani është shumë i madh. Ndaje në grupe më të vogla.");
  const id = randomUUID(); const fingerprint = createHash("sha256").update(JSON.stringify(steps)).digest("hex");
  const preview: Preview = { title: `Konfirmo planin me ${steps.length} hapa`, fields: steps.map((step, i) => ({ label: `${i + 1}. ${step.preview.title}`, before: "—", after: `${step.preview.subject ?? ""}\n${step.preview.fields.map(f => `${f.label}: ${f.after}`).join("\n")}${step.preview.notice ? `\n${step.preview.notice}` : ""}` })), notice: "Hapat kryhen sipas radhës. Nëse njëri dështon, hapat pas tij ndalojnë. Hapat e kryer nuk zhbëhen automatikisht." };
  const saved = await createServiceSupabase().from("business_operation_plans").insert({ id, business_id: businessId, user_id: userId, fingerprint, steps, title: preview.title });
  if (saved.error) throw new OperationError("Plani nuk u ruajt për shqyrtim.");
  return { id, fingerprint, steps, preview };
}
export async function resumeOperationPlan(businessId: string, userId: string, id: string, accessToken?: string): Promise<PreparedPlan> {
  await operationActor(businessId, userId, accessToken);
  const result = await createServiceSupabase().from("business_operation_plans").select("id,fingerprint,steps,title").eq("id", id).eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (result.error || !result.data) throw new OperationError("Plani nuk u gjet në punët e tua.");
  const steps = result.data.steps as PreparedOperation[];
  const receipts = await createServiceSupabase().from("business_operation_receipts").select("id,state").eq("business_id", businessId).eq("user_id", userId).in("id", steps.map(step => step.requestId));
  if (receipts.error) throw new OperationError("Progresi nuk u verifikua.");
  const state = new Map((receipts.data ?? []).map(row => [row.id, row.state]));
  return { id, fingerprint: result.data.fingerprint, steps, preview: { title: "Vazhdo planin", fields: steps.map((step, index) => ({ label: `${index + 1}. ${step.preview.title}`, before: "—", after: state.get(step.requestId) === "completed" ? "Përfunduar — nuk përsëritet" : `${step.preview.subject ?? ""}: ${state.get(step.requestId) ? "Kërkon verifikim të rezultatit" : "Në pritje"}\n${step.preview.fields.map(field => `${field.label}: ${field.after}`).join("\n")}\n${step.preview.notice ?? ""}` })), notice: "Hapat me rezultat të pasigurt nuk riprovohen automatikisht. Ndryshimi i të dhënave kërkon një propozim të ri për hapat e mbetur." } };
}
export async function executeOperationPlan(businessId: string, userId: string, plan: PreparedPlan, accessToken?: string) {
  await operationActor(businessId, userId, accessToken);
  const db = createServiceSupabase();
  const stored = await db.from("business_operation_plans").select("fingerprint,steps").eq("id", plan.id).eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (stored.error || !stored.data || stored.data.fingerprint !== plan.fingerprint || !isDeepStrictEqual(stored.data.steps, plan.steps)) throw new OperationError("Plani ndryshoi. Rishqyrtoje.");
  let completed = 0;
  for (const step of stored.data.steps as PreparedOperation[]) {
    try { await executeOperation(businessId, userId, step, accessToken); completed += 1; }
    catch (error) {
      await db.from("business_operation_plans").update({ state: "blocked", updated_at: new Date().toISOString() }).eq("id", plan.id).eq("business_id", businessId).eq("user_id", userId);
      throw new OperationError(`U përfunduan ${completed}/${plan.steps.length} hapa. Plani ${plan.id} u ndal te “${step.preview.title}”: ${error instanceof OperationError ? error.message : "Rezultati i hapit nuk u konfirmua. Kontrollo gjendjen."} Hapat e kryer ruhen dhe nuk përsëriten gjatë vazhdimit.`);
    }
  }
  const saved = await db.from("business_operation_plans").update({ state: "completed", updated_at: new Date().toISOString() }).eq("id", plan.id).eq("business_id", businessId).eq("user_id", userId);
  if (saved.error) throw new OperationError("Hapat përfunduan, por gjendja e planit nuk u përditësua. Dëftesat ruajnë rezultatet.");
  return { message: `U përfunduan të ${completed} hapat e planit.`, path: "activity" };
}

// Version 2 extends the existing plan ledger. Definitions and their fingerprint
// are immutable; resolved snapshots are persisted before dispatch, with CAS.
import { configurationActor } from "./access";
import { parseConfigurationSteps, resolveConfigurationInput, type ConfigurationStep } from "./configuration-policy";
import { requireModuleAllowed } from "@/lib/dashboard/modules/entitlements";
import { operationCatalog, type OperationKey } from "./catalog";
import type { ConfigurationAuthority as ConfigurationReview } from "./configuration-policy";
export type ConfigurationPlan = { id: string; fingerprint: string; steps: { version: 2; definition: ConfigurationStep; requestId: string; prepared?: PreparedOperation; authority: ConfigurationReview }[] };
export async function prepareConfigurationPlan(businessId: string, userId: string, raw: unknown, authority: ConfigurationReview, accessToken?: string): Promise<ConfigurationPlan> {
  await configurationActor(businessId, userId, accessToken);
  const definitions = parseConfigurationSteps(raw);
  if (!Number.isFinite(authority.expires) || authority.expires <= Date.now() || authority.evidence.length !== definitions.length || new Set(authority.evidence.map(e => e.step)).size !== definitions.length ||
    authority.evidence.some(e => !Number.isInteger(e.step) || e.step < 0 || e.step >= definitions.length || !e.quote.trim() || !authority.request.includes(e.quote))) throw new OperationError("Autorizimi i konfigurimit nuk është i vlefshëm.");
  for (const step of definitions) await requireModuleAllowed(businessId, operationCatalog[step.key as OperationKey].module);
  const steps: ConfigurationPlan["steps"] = definitions.map(definition => ({version: 2, definition, requestId: randomUUID(), authority}));
  // Preflight independent steps before any business mutation. Dependent snapshots
  // must be prepared after their predecessors; they cannot be fabricated here.
  for (const step of steps) if (!step.definition.after?.length && !Object.keys(step.definition.references ?? {}).length) {
    step.prepared = await prepareOperation(businessId, userId, step.definition.key, step.definition.input, accessToken);
    step.prepared.requestId = step.requestId;
  }
  const id = randomUUID(), fingerprint = configurationFingerprint(steps);
  const saved = await createServiceSupabase().from("business_operation_plans").insert({id, business_id: businessId, user_id: userId, fingerprint, steps, title: "Konfigurimi i biznesit"});
  if (saved.error) throw new OperationError("Konfigurimi nuk u ruajt për ekzekutim.");
  return {id, fingerprint, steps};
}
export async function executeConfigurationPlan(businessId: string, userId: string, planId: string, accessToken?: string) {
  await configurationActor(businessId, userId, accessToken);
  const db = createServiceSupabase();
  const loaded = await db.from("business_operation_plans").select("steps,fingerprint,state").eq("id", planId).eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (loaded.error || !loaded.data || !Array.isArray(loaded.data.steps) || !loaded.data.steps.length || loaded.data.steps.some((s: {version: number}) => s.version !== 2)) throw new OperationError("Konfigurimi nuk u gjet.");
  let steps = loaded.data.steps as ConfigurationPlan["steps"];
  parseConfigurationSteps(steps.map(s => s.definition));
  if (configurationFingerprint(steps) !== loaded.data.fingerprint) throw new OperationError("Konfigurimi ka ndryshuar.");
  const outputs: {id?: string}[] = [];
  const completed: string[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    try {
      await configurationActor(businessId, userId, accessToken);
      await requireModuleAllowed(businessId, operationCatalog[step.definition.key as OperationKey].module);
      const receipt = await db.from("business_operation_receipts").select("state,result").eq("id", step.requestId).eq("business_id", businessId).eq("user_id", userId).maybeSingle();
      if (receipt.error) throw new OperationError("Progresi nuk u verifikua.");
      if (receipt.data?.state === "completed") { outputs.push(receipt.data.result ?? {}); completed.push(step.prepared?.preview.title ?? step.definition.key); continue; }
      if (receipt.data) throw new OperationError("Hapi është në proces ose rezultati është i pasigurt. Nuk u përsërit.");
      if (step.authority.expires <= Date.now()) throw new OperationError("Autorizimi ka skaduar. Kërko vazhdimin e konfigurimit.");
      const input = resolveConfigurationInput(step.definition, outputs);
      if (!step.prepared) {
        const prepared = await prepareOperation(businessId, userId, step.definition.key, input, accessToken);
        prepared.requestId = step.requestId;
        const next = structuredClone(steps); next[index].prepared = prepared;
        const persisted = await db.from("business_operation_plans").update({steps: next, updated_at: new Date().toISOString()}).eq("id", planId).eq("business_id", businessId).eq("user_id", userId).eq("steps", JSON.stringify(steps)).select("id").maybeSingle();
        if (persisted.error || !persisted.data) throw new OperationError("Konfigurimi po përpunohet nga një kërkesë tjetër. Progresi është ruajtur.");
        steps = next;
      }
      const prepared = steps[index].prepared!;
      if (prepared.key !== step.definition.key || prepared.requestId !== step.requestId || !isDeepStrictEqual(prepared.input,input)) throw new OperationError("Hapi i përgatitur nuk përputhet me konfigurimin e autorizuar.");
      const result = await executeOperation(businessId, userId, prepared, accessToken);
      outputs.push("id" in result && typeof result.id === "string" ? {id: result.id} : {}); completed.push(steps[index].prepared!.preview.title);
    } catch (error) {
      await db.from("business_operation_plans").update({state:"blocked", updated_at:new Date().toISOString()}).eq("id",planId).eq("business_id",businessId).eq("user_id",userId);
      return {planId, completed, total: steps.length, state: "blocked" as const, message: `U kryen ${completed.length}/${steps.length} hapa. ${error instanceof OperationError ? error.message : "Hapi nuk u konfirmua. Progresi është ruajtur për verifikim."}`};
    }
  }
  const saved = await db.from("business_operation_plans").update({state:"completed",updated_at:new Date().toISOString()}).eq("id",planId).eq("business_id",businessId).eq("user_id",userId);
  if (saved.error) throw new OperationError("Hapat u kryen; përmbledhja e progresit nuk u konfirmua. Mos e rikrijo konfigurimin.");
  return {planId, completed, total: steps.length, state:"completed" as const, message:`Konfigurimi u krye: ${completed.join("; ")}.`};
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,canonical(v)]));
  return value;
}
export function configurationFingerprint(steps: ConfigurationPlan["steps"]) {
  return createHash("sha256").update(JSON.stringify(canonical(steps.map(({definition,requestId,authority})=>({definition,requestId,authority}))))).digest("hex");
}

export async function loadConfigurationPlan(businessId: string, userId: string, id: string, accessToken?: string): Promise<ConfigurationPlan> {
  await configurationActor(businessId,userId,accessToken);
  const result = await createServiceSupabase().from("business_operation_plans").select("steps,fingerprint").eq("id",id).eq("business_id",businessId).eq("user_id",userId).maybeSingle();
  if (result.error || !result.data || !Array.isArray(result.data.steps) || result.data.steps.some((s:{version:number})=>s.version!==2)) throw new OperationError("Konfigurimi nuk u gjet.");
  const plan = {id,steps:result.data.steps as ConfigurationPlan["steps"],fingerprint:result.data.fingerprint};
  if (configurationFingerprint(plan.steps)!==plan.fingerprint) throw new OperationError("Konfigurimi ka ndryshuar.");
  return plan;
}
export async function renewConfigurationPlan(businessId: string, userId: string, plan: ConfigurationPlan, authority: ConfigurationReview, accessToken?: string) {
  await configurationActor(businessId,userId,accessToken);
  if (!Number.isFinite(authority.expires) || authority.expires <= Date.now() || authority.evidence.length !== plan.steps.length || new Set(authority.evidence.map(e=>e.step)).size!==plan.steps.length || authority.evidence.some(e=>e.step<0 || e.step>=plan.steps.length || !Number.isInteger(e.step) || !e.quote.trim() || !authority.request.includes(e.quote))) throw new OperationError("Vazhdimi kërkon autorizim të vlefshëm.");
  // Do not erase prepared snapshots or uncertain receipts. Fresh consent does not
  // authorize reapplying stale changes or replaying effects with unknown outcomes.
  const steps=plan.steps.map(step=>({...step,authority}));
  const saved=await createServiceSupabase().from("business_operation_plans").update({steps,fingerprint:configurationFingerprint(steps),updated_at:new Date().toISOString()})
    .eq("id",plan.id).eq("business_id",businessId).eq("user_id",userId).eq("steps",JSON.stringify(plan.steps)).select("id").maybeSingle();
  if(saved.error || !saved.data) throw new OperationError("Progresi ndryshoi. Rihap konfigurimin.");
}

export async function readConfigurationProgress(businessId: string, userId: string, id: string, accessToken?: string) {
  const plan=await loadConfigurationPlan(businessId,userId,id,accessToken);
  const result=await createServiceSupabase().from("business_operation_receipts").select("id,state").eq("business_id",businessId).eq("user_id",userId).in("id",plan.steps.map(s=>s.requestId));
  if(result.error) throw new OperationError("Progresi nuk u verifikua.");
  const completedIds=new Set((result.data??[]).filter(r=>r.state==="completed").map(r=>r.id));
  const completed=plan.steps.filter(s=>completedIds.has(s.requestId)).map(s=>s.prepared?.preview.title??operationCatalog[s.definition.key as OperationKey].title);
  return {planId:id,completed,total:plan.steps.length,state:completed.length===plan.steps.length?"completed" as const:"blocked" as const};
}
