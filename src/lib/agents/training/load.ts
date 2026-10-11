import { createServiceSupabase } from "@/lib/supabase/service";
import { MEMORY_LIMIT, type TrainingMemory } from "./model";
export async function loadActiveTrainingMemories(businessId: string) {
  let result: { data: TrainingMemory[] | null; error: { code: string } | null } = await createServiceSupabase().from("agent_training_memories")
    .select("id,business_id,kind,instruction,customer_message,desired_response,workflow_id,step_key,visual_flow_id,visual_node_id,is_active,revision,updated_at")
    .eq("business_id", businessId).eq("is_active", true).order("updated_at", { ascending: false }).limit(MEMORY_LIMIT);
  if (result.error && ["42703", "PGRST204"].includes(result.error.code)) {
    result = await createServiceSupabase().from("agent_training_memories")
      .select("id,business_id,kind,instruction,customer_message,desired_response,workflow_id,step_key,is_active,revision,updated_at")
      .eq("business_id", businessId).eq("is_active", true).order("updated_at", { ascending: false }).limit(MEMORY_LIMIT);
  }
  // Rolling deployment: existing replies work before the additive migration is installed.
  if (result.error && ["42P01", "PGRST205"].includes(result.error.code)) return [];
  if (result.error) throw new Error("Nuk u ngarkua memoria e Agjentit.");
  return (result.data ?? []) as TrainingMemory[];
}
