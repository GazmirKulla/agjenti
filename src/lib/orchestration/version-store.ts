import { createServiceSupabase } from "@/lib/supabase/service";
import { loadVisualVersion } from "@/lib/workflows/visual/store";
import type { WorkflowStepDef } from "@/lib/workflows/engine";
import { linearProcessVersion, compileLinearProcess, type ProcessVersion } from "./linear-definition";
import { compileVisualProcesses } from "./visual-definition";
export function compileProcessVersion(version: ProcessVersion) { return version.linear ? [compileLinearProcess(version)] : compileVisualProcesses(version); }
export async function loadProcessVersion(businessId: string, id: string): Promise<ProcessVersion | null> {
  const db = createServiceSupabase();
  const { data, error } = await db.from("linear_workflow_versions").select("id,workflow_id,name,steps").eq("business_id", businessId).eq("id", id).maybeSingle();
  if (error) throw new Error("process_version_unavailable");
  if (!data) return loadVisualVersion(businessId, id);
  const products = await db.from("products").select("id").eq("business_id", businessId).eq("workflow_id", data.workflow_id).eq("is_active", true);
  if (products.error) throw new Error("process_binding_unavailable");
  return linearProcessVersion({ id: data.id, businessId, workflowId: data.workflow_id, name: data.name, steps: data.steps as WorkflowStepDef[], productIds: (products.data ?? []).map(p => p.id) });
}
export async function loadCurrentLinearVersions(businessId: string): Promise<ProcessVersion[]> {
  const db = createServiceSupabase(), products: { id: string; workflow_id: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await db.from("products").select("id,workflow_id").eq("business_id", businessId).eq("is_active", true).not("workflow_id", "is", null).order("id").range(offset, offset + 999);
    if (result.error) throw new Error("process_binding_unavailable");
    products.push(...result.data ?? []); if ((result.data?.length ?? 0) < 1000) break;
  }
  return Promise.all([...new Set(products.map(p => p.workflow_id!))].map(async workflowId => {
    const { data, error } = await db.from("linear_workflow_versions").select("id,name,steps").eq("business_id", businessId).eq("workflow_id", workflowId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) throw new Error("process_version_unavailable");
    return linearProcessVersion({ id: data.id, businessId, workflowId, name: data.name, steps: data.steps as WorkflowStepDef[], productIds: products.filter(p => p.workflow_id === workflowId).map(p => p.id) });
  }));
}
