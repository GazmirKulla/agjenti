import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";
import {
  canEnableModule,
  modulesBrokenByDisable,
} from "@/lib/dashboard/modules/dependencies";
import type { DashboardProfile } from "@/lib/dashboard/modules/types";
import { saveModules } from "@/lib/dashboard/modules/actions";
import { ActionForm } from "@/components/dashboard/action-form";

export function ModulesSettingsPanel({
  slug,
  profile,
}: {
  slug: string;
  businessId: string;
  profile: DashboardProfile;
}) {
  const enabled = new Set(profile.enabledModules);

  return (
    <ActionForm action={saveModules.bind(null, slug)} className="panel section-pad grid gap-5">
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
