import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { loadAllowedModules } from "@/lib/dashboard/modules/entitlements";
import { getCapability, type CapabilityAvailability } from "./registry";
import type { ReadinessFinding } from "./diagnostics";

/** Explicit per-business rollout. Never derive this switch from a client request. */
export function moduleEnforcementEnabled(businessId: string): boolean {
  // Legacy readiness rollout only. This no longer chooses module permissions.
  return (process.env.MODULE_ENFORCEMENT_BUSINESS_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean).includes(businessId);
}

export class CapabilityEnforcementError extends Error {
  constructor(public readonly code: CapabilityAvailability | "binding_unavailable", message: string, public readonly findings?: ReadinessFinding[]) { super(message); }
}

export async function runtimeModules(businessId: string): Promise<string[] | null> {
  try {
    // Both readers now resolve the same server capability list. The legacy path
    // avoids a presentation-profile read; neither enforces navigation choices.
    if (!moduleEnforcementEnabled(businessId)) return await loadAllowedModules(businessId);
    return (await loadDashboardProfile(businessId)).enabledModules;
  }
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
