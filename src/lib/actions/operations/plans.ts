import { isDeepStrictEqual } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { operationActor } from "./access";
import { prepareOperation, executeOperation, type PreparedOperation } from "./service";
import type { Preview } from "@/lib/business-assistant/model";

type PlanStep = { key: string; input: Record<string, unknown>; after?: number[] };
export type PreparedPlan = { id: string; fingerprint: string; steps: PreparedOperation[]; preview: Preview };
export function parsePlan(input: unknown): PlanStep[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 10) throw Error("Plani duhet të ketë 2–10 hapa.");
  const targets = new Set<string>();
  return input.map((step, index) => {
    if (!step || typeof step !== "object" || Object.keys(step).some(key => !["key", "input", "after"].includes(key)) || typeof step.key !== "string" || !step.input || typeof step.input !== "object" || Array.isArray(step.input)) throw Error("Hap i pavlefshëm në plan.");
    if (step.after !== undefined && (!Array.isArray(step.after) || step.after.some((n: unknown) => !Number.isInteger(n) || Number(n) < 0 || Number(n) >= index))) throw Error("Varësitë e planit duhet t’u referohen hapave të mëparshëm.");
    // Merge edits to a single record before asking for approval. Two independently
    // prepared snapshots of one target would invalidate each other after step one.
    const target = `${step.key.split(".")[0]}:${step.input.id ?? step.input.conversationId ?? (step.key.endsWith(".settings") || step.key === "business.autoreply" ? "settings" : index)}`;
    if (targets.has(target)) throw Error("Bashko ndryshimet për të njëjtin element në një hap.");
    targets.add(target);
    return step as PlanStep;
  });
}
export async function prepareOperationPlan(businessId: string, userId: string, raw: unknown, accessToken?: string): Promise<PreparedPlan> {
  await operationActor(businessId, userId, accessToken);
  const requested = parsePlan(raw);
  const steps: PreparedOperation[] = [];
  for (const step of requested) steps.push(await prepareOperation(businessId, userId, step.key, step.input, accessToken));
  if (JSON.stringify(steps).length > 90000) throw Error("Plani është shumë i madh. Ndaje në grupe më të vogla.");
  const id = randomUUID(); const fingerprint = createHash("sha256").update(JSON.stringify(steps)).digest("hex");
  const preview: Preview = { title: `Konfirmo planin me ${steps.length} hapa`, fields: steps.map((step, i) => ({ label: `${i + 1}. ${step.preview.title}`, before: "—", after: `${step.preview.subject ?? ""}\n${step.preview.fields.map(f => `${f.label}: ${f.after}`).join("\n")}${step.preview.notice ? `\n${step.preview.notice}` : ""}` })), notice: "Hapat kryhen sipas radhës. Nëse njëri dështon, hapat pas tij ndalojnë. Hapat e kryer nuk zhbëhen automatikisht." };
  const saved = await createServiceSupabase().from("business_operation_plans").insert({ id, business_id: businessId, user_id: userId, fingerprint, steps, title: preview.title });
  if (saved.error) throw Error("Plani nuk u ruajt për shqyrtim.");
  return { id, fingerprint, steps, preview };
}
export async function resumeOperationPlan(businessId: string, userId: string, id: string, accessToken?: string): Promise<PreparedPlan> {
  await operationActor(businessId, userId, accessToken);
  const result = await createServiceSupabase().from("business_operation_plans").select("id,fingerprint,steps,title").eq("id", id).eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (result.error || !result.data) throw Error("Plani nuk u gjet në punët e tua.");
  const steps = result.data.steps as PreparedOperation[];
  const receipts = await createServiceSupabase().from("business_operation_receipts").select("id,state").eq("business_id", businessId).eq("user_id", userId).in("id", steps.map(step => step.requestId));
  if (receipts.error) throw Error("Progresi nuk u verifikua.");
  const state = new Map((receipts.data ?? []).map(row => [row.id, row.state]));
  return { id, fingerprint: result.data.fingerprint, steps, preview: { title: "Vazhdo planin", fields: steps.map((step, index) => ({ label: `${index + 1}. ${step.preview.title}`, before: "—", after: state.get(step.requestId) === "completed" ? "Përfunduar — nuk përsëritet" : `${step.preview.subject ?? ""}: ${state.get(step.requestId) ? "Kërkon verifikim të rezultatit" : "Në pritje"}\n${step.preview.fields.map(field => `${field.label}: ${field.after}`).join("\n")}\n${step.preview.notice ?? ""}` })), notice: "Hapat me rezultat të pasigurt nuk riprovohen automatikisht. Ndryshimi i të dhënave kërkon një propozim të ri për hapat e mbetur." } };
}
export async function executeOperationPlan(businessId: string, userId: string, plan: PreparedPlan, accessToken?: string) {
  await operationActor(businessId, userId, accessToken);
  const db = createServiceSupabase();
  const stored = await db.from("business_operation_plans").select("fingerprint,steps").eq("id", plan.id).eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (stored.error || !stored.data || stored.data.fingerprint !== plan.fingerprint || !isDeepStrictEqual(stored.data.steps, plan.steps)) throw Error("Plani ndryshoi. Rishqyrtoje.");
  let completed = 0;
  for (const step of stored.data.steps as PreparedOperation[]) {
    try { await executeOperation(businessId, userId, step, accessToken); completed += 1; }
    catch (error) {
      await db.from("business_operation_plans").update({ state: "blocked", updated_at: new Date().toISOString() }).eq("id", plan.id).eq("business_id", businessId).eq("user_id", userId);
      throw Error(`U përfunduan ${completed}/${plan.steps.length} hapa. Plani ${plan.id} u ndal te “${step.preview.title}”: ${(error as Error).message} Hapat e kryer ruhen dhe nuk përsëriten gjatë vazhdimit.`);
    }
  }
  const saved = await db.from("business_operation_plans").update({ state: "completed", updated_at: new Date().toISOString() }).eq("id", plan.id).eq("business_id", businessId).eq("user_id", userId);
  if (saved.error) throw Error("Hapat përfunduan, por gjendja e planit nuk u përditësua. Dëftesat ruajnë rezultatet.");
  return { message: `U përfunduan të ${completed} hapat e planit.`, path: "activity" };
}
