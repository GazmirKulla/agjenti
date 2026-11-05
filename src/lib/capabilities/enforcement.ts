import { loadAllowedModules } from "@/lib/dashboard/modules/entitlements";
import { getCapability, type CapabilityAvailability } from "./registry";
import type { ReadinessFinding } from "./diagnostics";

export class CapabilityEnforcementError extends Error {
  constructor(public readonly code: CapabilityAvailability | "binding_unavailable", message: string, public readonly findings?: ReadinessFinding[]) { super(message); }
}

export async function runtimeModules(businessId: string): Promise<string[] | null> {
  try {
    return await loadAllowedModules(businessId);
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
