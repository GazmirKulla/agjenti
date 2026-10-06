import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";
import {
  canEnableModule,
  modulesBrokenByDisable,
} from "@/lib/dashboard/modules/dependencies";
import type { DashboardProfile, ModuleId } from "@/lib/dashboard/modules/types";
import { rebuildProfileFromModules } from "@/lib/dashboard/profile/generate";
import { saveDashboardProfile } from "@/lib/dashboard/profile/service";
import { ActionForm } from "@/components/dashboard/action-form";
import { revalidatePath } from "next/cache";

export function ModulesSettingsPanel({
  slug,
  businessId,
  profile,
}: {
  slug: string;
  businessId: string;
  profile: DashboardProfile;
}) {
  async function saveModules(formData: FormData) {
    "use server";
    const selected = toggleableModules.filter(
      (id) => formData.get(`module_${id}`) === "on",
    );
    const core = profile.enabledModules.filter(
      (id) => moduleRegistry[id].core,
    );
    const provisional = new Set<ModuleId>([...core, ...selected]);
    for (const id of selected) {
      const check = canEnableModule(id, provisional);
      if (!check.ok) return { error: check.reason };
    }
    const rebuilt = rebuildProfileFromModules(
      [...provisional],
      profile.signals,
    );
    await saveDashboardProfile(businessId, rebuilt);
    revalidatePath(`/b/${slug}`, "layout");
    return { success: "Modulet e hapësirës u përditësuan." };
  }

  const enabled = new Set(profile.enabledModules);

  return (
    <ActionForm action={saveModules} className="panel section-pad grid gap-5">
      <div className="section-title">
        <div>
          <h2>Modulet e hapësirës</h2>
          <p className="muted-copy">
            Aktivizo vetëm ato që i përdor biznesi. Varësitë kontrollohen
            automatikisht.
          </p>
        </div>
        <button className="btn btn-primary" type="submit">
          Ruaj modulet
        </button>
      </div>
      <div className="grid gap-3">
        {toggleableModules.map((id) => {
          const mod = moduleRegistry[id];
          const isOn = enabled.has(id);
          const enableCheck = canEnableModule(id, enabled);
          const broken = isOn ? modulesBrokenByDisable(id, enabled) : [];
          const blocked =
            !isOn && !enableCheck.ok ? enableCheck.reason : undefined;
          return (
            <label key={id} className="toggle-label">
              <span>
                {mod.label}
                <small>
                  {mod.description}
                  {blocked ? ` — ${blocked}` : ""}
                  {broken.length
                    ? ` — çaktivizimi heq edhe: ${broken
                        .map((dep) => moduleRegistry[dep].label)
                        .join(", ")}`
                    : ""}
                </small>
              </span>
              <input
                type="checkbox"
                name={`module_${id}`}
                className="switch-input"
                defaultChecked={isOn}
                disabled={Boolean(blocked)}
              />
            </label>
          );
        })}
      </div>
      {profile.source === "legacy" && (
        <p className="muted-copy" role="status">
          Ky biznes po përdor panelin klasik. Ruajtja e moduleve aktivizon
          panelin adaptiv.
        </p>
      )}
    </ActionForm>
  );
}
