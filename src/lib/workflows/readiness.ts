import { createServiceSupabase } from "@/lib/supabase/service";
import { sharedWorkflowEnabled } from "./context";

export type WorkflowReadiness = { ready: boolean; blockers: string[] };
/** Server-only deployment health. Never return secrets or another tenant's data. */
export async function loadWorkflowReadiness(businessId: string): Promise<WorkflowReadiness> {
  const blockers: string[] = [];
  if (!sharedWorkflowEnabled(businessId)) blockers.push("Aktivizo për këtë biznes përpunimin në radhë dhe kujtesën e përbashkët.");
  if (!process.env.CRON_SECRET?.trim()) blockers.push("Konfiguro çelësin e rikuperimit të mesazheve.");
  const { data, error } = await createServiceSupabase().rpc("workflow_runtime_readiness");
  if (error || data?.schemaVersion !== 3) {
    blockers.push("Apliko migrimet e workflow-t bisedor në Supabase.");
  } else {
    if (!data.scheduled) blockers.push("Aktivizo rikuperimin çdo minutë në Supabase.");
    const last = typeof data.lastSuccessAt === "string" ? Date.parse(data.lastSuccessAt) : NaN;
    if (!Number.isFinite(last) || Date.now() - last > 3 * 60000) blockers.push("Rikuperimi i mesazheve ende nuk ka konfirmuar funksionimin.");
  }
  return { ready: blockers.length === 0, blockers };
}
