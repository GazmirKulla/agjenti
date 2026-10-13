import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { getCapability, type CapabilityAvailability } from "./registry";

/** Explicit per-business rollout. Never derive this switch from a client request. */
export function moduleEnforcementEnabled(businessId: string): boolean {
  return (process.env.MODULE_ENFORCEMENT_BUSINESS_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean).includes(businessId);
}

export class CapabilityEnforcementError extends Error {
  constructor(public readonly code: CapabilityAvailability | "binding_unavailable", message: string) { super(message); }
}

export async function runtimeModules(businessId: string): Promise<string[] | null> {
  if (!moduleEnforcementEnabled(businessId)) return null;
  try { return (await loadDashboardProfile(businessId, { requireExplicit: true })).enabledModules; }
  catch { throw new CapabilityEnforcementError("unverified", "Nuk u verifikuan modulet e biznesit. Provo përsëri; progresi yt është ruajtur."); }
}

export async function requireRuntimeModules(businessId: string, required: string[]) {
  const enabled = await runtimeModules(businessId);
  if (enabled && required.some(module => !enabled.includes(module)))
    throw new CapabilityEnforcementError("module_disabled", "Ky veprim është çaktivizuar për biznesin. Progresi yt është ruajtur; kontakto biznesin për të vazhduar.");
}

export function capabilityModules(keys: string[]): string[] {
  return [...new Set(keys.flatMap(key => getCapability(key)?.requiredModules ?? []))];
}
