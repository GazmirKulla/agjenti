import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";
import type { DashboardProfile } from "@/lib/dashboard/modules/types";
import { saveModules } from "@/lib/dashboard/modules/actions";
import { ActionForm } from "@/components/dashboard/action-form";

export async function ModulesSettingsPanel({ slug, profile }: {
  slug: string; businessId: string; profile: DashboardProfile;
}) {
  return <ActionForm action={saveModules.bind(null, slug)} className="panel section-pad grid gap-5">
    <div className="section-title"><div><h2>Seksionet e panelit</h2>
      <p className="muted-copy">Seksionet shfaqen sipas përdorimit. Zgjidh çfarë dëshiron të shohësh në menu. Fshehja nuk ndalon asistentin dhe nuk fshin të dhënat.</p>
    </div><button className="btn btn-primary" type="submit">Ruaj pamjen</button></div>
    <div className="grid gap-3">{toggleableModules.map(id => <label key={id} className="toggle-label">
      <span>{moduleRegistry[id].label}<small>{moduleRegistry[id].description}</small></span>
      <input type="checkbox" name={`module_${id}`} className="switch-input"
        defaultChecked={profile.navigationItems.includes(id)} />
    </label>)}</div>
  </ActionForm>;
}
