"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isUuid, MEMORY_LIMIT, validateTrainingInput, type TrainingInput, type TrainingMemory, type TrainingTarget, type TrainingWorkflow } from "./model";
import { loadVisualFlowChoices } from "@/lib/workflows/visual/choices";
import { readTrainingReceipt } from "./receipt";

async function accessTraining(target: TrainingTarget) {
  const user = await getSessionUser();
  if (!user) throw new Error("Hyr në llogari për të trajnuar Agjentin.");
  if (target && "slug" in target && typeof target.slug === "string" && target.slug.length <= 150) {
    const access = await requireBusinessAccess(user.id, target.slug);
    if (!access) throw new Error("Nuk ke qasje në këtë biznes.");
    return { userId: user.id, business: access.business };
  }
  if (!target || !("businessId" in target) || !isUuid(target.businessId) || !(await isPlatformAdmin(user.id))) throw new Error("Nuk ke qasje në këtë biznes.");
  const result = await createServiceSupabase().from("businesses").select("id,slug").eq("id", target.businessId).single();
  if (result.error || !result.data) throw new Error("Biznesi nuk u gjet.");
  return { userId: user.id, business: result.data as { id: string; slug: string } };
}
function databaseError(code?: string): never {
  if (["42P01", "PGRST205", "42703", "PGRST204"].includes(code ?? "")) throw new Error("Trajnimi kërkon migrimin e ri të databazës. Kontakto administratorin.");
  throw new Error("Ndryshimi nuk u ruajt. Rifresko dhe provo përsëri.");
}
function refresh(slug: string) {
  revalidatePath(`/b/${slug}`, "layout");
  revalidatePath("/admin/chat-lab");
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Trajnimi nuk u përfundua. Provo përsëri.";

export async function listAgentTraining(target: TrainingTarget): Promise<{ memories: TrainingMemory[]; workflows: TrainingWorkflow[]; migrationRequired?: boolean } | { error: string }> {
  try {
    const { business } = await accessTraining(target);
    const db = createServiceSupabase();
    const [visual, loadedMemories, workflows] = await Promise.all([
      loadVisualFlowChoices(business.id),
      db.from("agent_training_memories").select("id,business_id,kind,instruction,customer_message,desired_response,workflow_id,step_key,visual_flow_id,visual_node_id,is_active,revision,updated_at").eq("business_id", business.id).order("updated_at", { ascending: false }).limit(MEMORY_LIMIT),
      db.from("workflows").select("id,name").eq("business_id", business.id).order("name").limit(200),
    ]);
    const migrationRequired = Boolean(loadedMemories.error && ["42703", "PGRST204"].includes(loadedMemories.error.code));
    let memories: { data: TrainingMemory[] | null; error: { code: string } | null } = loadedMemories;
    if (memories.error && ["42703", "PGRST204"].includes(memories.error.code)) {
      memories = await db.from("agent_training_memories").select("id,business_id,kind,instruction,customer_message,desired_response,workflow_id,step_key,is_active,revision,updated_at").eq("business_id", business.id).order("updated_at", { ascending: false }).limit(MEMORY_LIMIT);
    }
    if (memories.error) databaseError(memories.error.code);
    if (workflows.error) databaseError(workflows.error.code);
    const definitions = workflows.data?.length ? await db.from("workflow_steps").select("workflow_id,key,config").in("workflow_id", workflows.data.map(w => w.id)).order("position").limit(4000) : { data: [], error: null };
    if (definitions.error) databaseError(definitions.error.code);
    return { migrationRequired, memories: (memories.data ?? []) as TrainingMemory[], workflows: [...visual.flows.map(f => ({ id: `visual:${f.id}`, visualFlowId: f.id, name: f.name, status: f.status, steps: f.steps })), ...(workflows.data ?? []).map(w => ({ ...w, steps: (definitions.data ?? []).filter(s => s.workflow_id === w.id).map(s => ({ key: s.key, label: typeof s.config?.label === "string" ? s.config.label : s.key })) }))] };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function saveAgentTraining(target: TrainingTarget, input: TrainingInput): Promise<{ success: true } | { error: string }> {
  try {
    const { business, userId } = await accessTraining(target);
    validateTrainingInput(input);
    const db = createServiceSupabase();
    // Feedback provenance is generated from an actual turn and bound to user + tenant.
    const receipt = input.receipt ? readTrainingReceipt(input.receipt, userId, business.id) : null;
    if (receipt && (input.customerMessage ?? "").trim() !== receipt.question.trim()) throw new Error("Pyetja e shembullit nuk përputhet me përgjigjen e provës.");
    if (input.workflowId) {
      const workflow = await db.from("workflows").select("id").eq("business_id", business.id).eq("id", input.workflowId).maybeSingle();
      if (workflow.error || !workflow.data) throw new Error("Workflow nuk i përket këtij biznesi.");
      if (input.stepKey) {
        const step = await db.from("workflow_steps").select("key").eq("workflow_id", input.workflowId).eq("key", input.stepKey).maybeSingle();
        if (step.error || !step.data) throw new Error("Ky hap nuk ekziston në workflow. Rifresko listën.");
      }
    }
    if (input.visualFlowId) {
      const choices = await loadVisualFlowChoices(business.id);
      const flow = choices.flows.find(f => f.id === input.visualFlowId);
      if (!flow || (input.visualNodeId && !flow.steps.some(n => n.key === input.visualNodeId))) throw new Error("Rrjedha ose hapi nuk gjendet në këtë biznes. Rifresko listën.");
    }
    const values = {
      kind: input.kind, instruction: input.instruction.trim(), customer_message: input.kind === "example" ? input.customerMessage?.trim() ?? "" : "", desired_response: input.kind === "example" ? input.desiredResponse?.trim() ?? "" : "",
      workflow_id: input.workflowId ?? null, step_key: input.stepKey ?? null, visual_flow_id: input.visualFlowId ?? null, visual_node_id: input.visualNodeId ?? null, updated_by: userId,
    };
    const persist = (payload: Record<string, unknown>) => input.id
      ? db.from("agent_training_memories").update(payload).eq("business_id", business.id).eq("id", input.id).eq("revision", input.revision!).select("id").maybeSingle()
      : db.from("agent_training_memories").insert({ ...payload, business_id: business.id, created_by: userId, source: receipt ? "test_feedback" : "manual" }).select("id").single();
    let result = await persist(values);
    if (result.error && ["42703", "PGRST204"].includes(result.error.code) && !input.visualFlowId) {
      const legacyValues: Record<string, unknown> = { ...values };
      delete legacyValues.visual_flow_id; delete legacyValues.visual_node_id;
      result = await persist(legacyValues);
    }
    if (result.error) {
      if (result.error.message?.includes("training_memory_limit")) throw new Error(`Ky biznes ka arritur ${MEMORY_LIMIT} mësime. Hiq një mësim përpara se të shtosh tjetër.`);
      databaseError(result.error.code);
    }
    if (!result.data) throw new Error("Ky mësim është ndryshuar nga dikush tjetër. Rifresko përpara ruajtjes.");
    refresh(business.slug);
    return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function changeAgentTraining(target: TrainingTarget, input: { id: string; revision: number; action: "enable" | "disable" | "delete" }): Promise<{ success: true } | { error: string }> {
  try {
    const { business, userId } = await accessTraining(target);
    if (!input || !isUuid(input.id) || !Number.isInteger(input.revision) || input.revision < 1 || !["enable", "disable", "delete"].includes(input.action)) throw new Error("Veprimi nuk është i vlefshëm.");
    const db = createServiceSupabase();
    // All mutations use tenant filtering and optimistic revisions. Delete is explicit.
    const query = input.action === "delete" ? db.from("agent_training_memories").delete() : db.from("agent_training_memories").update({ is_active: input.action === "enable", updated_by: userId });
    const result = await query.eq("business_id", business.id).eq("id", input.id).eq("revision", input.revision).select("id").maybeSingle();
    if (result.error) databaseError(result.error.code);
    if (!result.data) throw new Error("Ky mësim është ndryshuar ose është hequr. Rifresko listën.");
    refresh(business.slug);
    return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}
