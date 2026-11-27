import type { CommandActor } from "@/lib/actions/command-actor";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isUuid, MEMORY_LIMIT, validateTrainingInput, type TrainingInput, type TrainingMemory, type TrainingTarget, type TrainingWorkflow } from "./model";
import { loadVisualFlowChoices } from "@/lib/workflows/visual/choices";
import { readTrainingReceipt } from "./receipt";
import { saveConfiguration } from "@/lib/agent-configuration/service";

export async function accessTraining(target: TrainingTarget) {
  const user = await getSessionUser();
  if (!user) throw new Error("Hyr në llogari për të trajnuar Agjentin.");
  if (target && "slug" in target && typeof target.slug === "string" && target.slug.length <= 150) {
    const access = await requireBusinessAccess(user.id, target.slug);
    if (!access) throw new Error("Nuk ke qasje në këtë biznes.");
    return { userId: user.id, business: access.business };
  }
  if (!target || !("businessId" in target) || !isUuid(target.businessId) || !(await isPlatformAdmin(user.id))) throw new Error("Nuk ke qasje në këtë biznes.");
  const result = await createServiceSupabase().from("businesses").select("id,name,slug,catalog_source,auto_reply").eq("id", target.businessId).single();
  if (result.error || !result.data) throw new Error("Biznesi nuk u gjet.");
  return { userId: user.id, business: result.data as CommandActor["business"] };
}
function databaseError(code?: string): never {
  if (["42P01", "PGRST205", "42703", "PGRST204"].includes(code ?? "")) throw new Error("Trajnimi kërkon migrimin e ri të databazës. Kontakto administratorin.");
  throw new Error("Ndryshimi nuk u ruajt. Rifresko dhe provo përsëri.");
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

export async function saveAgentTraining(actor: CommandActor, input: TrainingInput): Promise<{ success: true } | { error: string }> {
  try {
    const { business, userId } = actor;
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
    // Through the agent configuration change: one version, checked against the lesson's revision.
    await saveConfiguration(business.id, userId, [{ type: "training.save", ...input }], "owner");
    return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}

export async function changeAgentTraining(actor: CommandActor, input: { id: string; revision: number; action: "enable" | "disable" | "delete" }): Promise<{ success: true } | { error: string }> {
  try {
    const { business, userId } = actor;
    if (!input || !isUuid(input.id) || !Number.isInteger(input.revision) || input.revision < 1 || !["enable", "disable", "delete"].includes(input.action)) throw new Error("Veprimi nuk është i vlefshëm.");
    void userId;
    await saveConfiguration(business.id, actor.userId, [input.action === "delete" ? { type: "training.delete", id: input.id, revision: input.revision }
      : { type: "training.active", id: input.id, is_active: input.action === "enable", revision: input.revision }], "owner");
    return { success: true };
  } catch (error) { return { error: errorMessage(error) }; }
}

/**
 * A business-wide style lesson saved before style moved to the agent's instructions: its text is added to the
 * instructions in use (a new version, restorable), then the lesson is removed so the setting lives in one place.
 */
export async function moveStyleToInstructions(actor: CommandActor, input: { id: string; revision: number }): Promise<{ success: string } | { error: string }> {
  try {
    const { business, userId } = actor;
    if (!input || !isUuid(input.id) || !Number.isInteger(input.revision) || input.revision < 1) throw new Error("Veprimi nuk është i vlefshëm.");
    const db = createServiceSupabase();
    const lesson = await db.from("agent_training_memories").select("id,kind,instruction,revision,is_active").eq("business_id", business.id).eq("id", input.id).maybeSingle();
    if (lesson.error) databaseError(lesson.error.code);
    if (!lesson.data || lesson.data.revision !== input.revision) throw new Error("Ky mësim është ndryshuar ose është hequr. Rifresko listën.");
    if (lesson.data.kind !== "style") throw new Error("Vetëm preferencat e stilit kalojnë te udhëzimet.");
    const agents = await db.from("ai_agents").select("id,instructions,is_active,updated_at").eq("business_id", business.id).order("is_active", { ascending: false }).limit(2);
    if (agents.error) throw new Error("Udhëzimet nuk u lexuan.");
    const agent = agents.data?.find(row => row.is_active) ?? (agents.data?.length === 1 ? agents.data[0] : null);
    if (!agent) throw new Error("Nuk u gjet agjenti aktiv. Aktivizoje te Agjenti → Si flet dhe kur thërret stafin, pastaj provo përsëri.");
    // A switched-off preference is not put into use by moving it.
    if (!lesson.data.is_active) throw new Error("Ky mësim është i fikur. Aktivizoje nëse dëshiron ta kalosh te udhëzimet, ose hiqe.");
    const text = lesson.data.instruction.trim();
    const instructions = agent.instructions.includes(text) ? agent.instructions : `${agent.instructions.trim()}\n\n${text}`;
    if (instructions.length > 8000) throw new Error("Udhëzimet do kalonin 8000 shkronja. Shkurtoji përpara se ta kalosh këtë preferencë.");
    // Instructions and the lesson change together, each against what was read: a parallel edit stops both.
    const receipt = await saveConfiguration(business.id, userId, [
      ...(instructions === agent.instructions ? [] : [{ type: "agent.update" as const, id: agent.id, instructions, expected: agent.updated_at }]),
      { type: "training.delete", id: input.id, revision: input.revision }], "memory");
    return { success: `U zbatua: preferenca u kalua te udhëzimet dhe u hoq nga memoria (versioni ${receipt.revision}).` };
  } catch (error) { return { error: errorMessage(error) }; }
}
