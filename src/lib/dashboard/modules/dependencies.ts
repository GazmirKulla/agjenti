import { moduleDependencies, moduleRegistry } from "./registry";
import type { ModuleId } from "./types";
import { MODULE_IDS } from "./types";

export function isModuleId(value: string): value is ModuleId {
  return (MODULE_IDS as readonly string[]).includes(value);
}

export function canEnableModule(
  moduleId: ModuleId,
  enabled: ReadonlySet<ModuleId>,
): { ok: true } | { ok: false; reason: string } {
  const rule = moduleDependencies[moduleId];
  if (rule.requires?.length) {
    const missing = rule.requires.filter((id) => !enabled.has(id));
    if (missing.length) {
      return {
        ok: false,
        reason: `${moduleRegistry[moduleId].label} kërkon: ${missing
          .map((id) => moduleRegistry[id].label)
          .join(", ")}.`,
      };
    }
  }
  if (rule.requiresAny?.length) {
    if (!rule.requiresAny.some((id) => enabled.has(id))) {
      return {
        ok: false,
        reason: `${moduleRegistry[moduleId].label} kërkon të paktën një nga: ${rule.requiresAny
          .map((id) => moduleRegistry[id].label)
          .join(", ")}.`,
      };
    }
  }
  if (rule.optionalFor?.length) {
    if (!rule.optionalFor.some((id) => enabled.has(id))) {
      return {
        ok: false,
        reason: `${moduleRegistry[moduleId].label} është opsional për: ${rule.optionalFor
          .map((id) => moduleRegistry[id].label)
          .join(", ")}. Aktivizo fillimisht njërin prej tyre.`,
      };
    }
  }
  return { ok: true };
}

export function dependentsOf(moduleId: ModuleId): ModuleId[] {
  return MODULE_IDS.filter((id) => {
    const rule = moduleDependencies[id];
    if (rule.requires?.includes(moduleId)) return true;
    if (rule.requiresAny?.length === 1 && rule.requiresAny[0] === moduleId)
      return true;
    if (
      rule.requiresAny?.includes(moduleId) &&
      rule.requiresAny.every((req) => req === moduleId || req === undefined)
    )
      return true;
    // Soft dependents: only auto-disable when requiresAny has no remaining match.
    return false;
  });
}

/** Modules that would break if `moduleId` is removed from the set. */
export function modulesBrokenByDisable(
  moduleId: ModuleId,
  enabled: ReadonlySet<ModuleId>,
): ModuleId[] {
  const next = new Set(enabled);
  next.delete(moduleId);
  return [...enabled].filter((id) => {
    if (id === moduleId) return false;
    return !canEnableModule(id, next).ok;
  });
}

export function normalizeEnabledModules(
  requested: readonly ModuleId[],
): ModuleId[] {
  const core = MODULE_IDS.filter((id) => moduleRegistry[id].core);
  const enabled = new Set<ModuleId>([...core, ...requested]);

  // Drop modules that violate dependencies (iterate until stable).
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...enabled]) {
      if (moduleRegistry[id].core) continue;
      const check = canEnableModule(id, enabled);
      if (!check.ok) {
        enabled.delete(id);
        changed = true;
      }
    }
  }

  return MODULE_IDS.filter((id) => enabled.has(id));
}
