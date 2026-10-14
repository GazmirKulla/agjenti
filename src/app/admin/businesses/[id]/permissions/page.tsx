import { ModuleDescription } from "@/components/dashboard/module-description";
import "@/components/dashboard/actions.css";
import Link from "next/link";
import { policyCatalog } from "@/lib/actions/policies";
import { toggleableModules } from "@/lib/dashboard/modules/registry";
import { loadAllowedModules } from "@/lib/dashboard/modules/entitlements";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { redirect, notFound } from "next/navigation";
import { saveActionPolicy } from "@/lib/actions/manage";
import { createServiceSupabase } from "@/lib/supabase/service";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading } from "@/components/dashboard/ui";
export default async function BusinessPermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const { id } = await params;
  const db = createServiceSupabase();
  const [record, overrides, events] = await Promise.all([
    db.from("businesses").select("id,name,slug").eq("id", id).maybeSingle(),
    db.from("business_actions").select("*").eq("business_id", id),
    db.from("action_executions").select("id,action_key,status,created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (record.error || overrides.error) return <p role="alert">Lejet nuk u ngarkuan. Provo përsëri.</p>;
  const business = record.data;
  if (!business) notFound();
  const [allowed, profile] = await Promise.all([loadAllowedModules(id), loadDashboardProfile(id)]);
  const allowedModules = new Set(allowed);
  const checks = await Promise.all(Object.keys(policyCatalog).filter(key => !key.startsWith("module.")).map(async key => {
    const result = await db.rpc("can_execute_business_action", { p_business: id, p_user: user.id, p_action: key, p_automated: false });
    return [key, result] as const;
  }));
  const permissions = new Map(checks);
  return <>
    <Link className="soft-link" href="/admin/businesses">← Bizneset</Link>
    <PageHeading eyebrow="Specifikat e biznesit" title={business.name} description="Leje të veçanta për modulet dhe aftësitë. Sipas paketës përdor rregullin e paketës; bllokimi global dhe varësitë kanë përparësi." />
            <div className="capability-grid">
              {Object.keys(policyCatalog).map(key => {
                const definition = policyCatalog[key];
                const existing = overrides.data?.find(o => o.business_id === business.id && o.action_key === key);
                const moduleId = toggleableModules.find(id => key === `module.${id}`);
                const provision = permissions.get(key);
                const allowed = moduleId ? allowedModules.has(moduleId) : provision?.data === true;
                return <article className="capability-card" key={`${business.id}:${key}`}>
                  <h3>{definition.name}</h3>
                  {moduleId ? <ModuleDescription moduleId={moduleId} /> : <p>{definition.description}</p>}
                  <p className="muted-copy">{!moduleId && provision?.error ? "Leja nuk u verifikua" : allowed ? "Lejohet" : "Nuk lejohet"}{moduleId && allowed ? profile?.enabledModules.includes(moduleId) ? " · aktiv në hapësirë" : " · joaktiv në hapësirë" : ""}</p>
                  <ActionForm action={saveActionPolicy} className="grid gap-3">
                    <input type="hidden" name="scope" value="business" />
                    <input type="hidden" name="target" value={business.id} />
                    <input type="hidden" name="action_key" value={key} />
                    <label>Leja<select className="field" name="enabled" defaultValue={existing?.enabled === true ? "true" : existing?.enabled === false ? "false" : "inherit"}>
                      <option value="inherit">Sipas paketës</option><option value="true">Lejo për këtë biznes</option><option value="false">Blloko për këtë biznes</option>
                    </select></label>
                    {key === "business.provision" && <label>Krijime në muaj (bosh = sipas paketës)<input className="field" name="monthly_limit" type="number" min="0" defaultValue={existing?.monthly_limit ?? ""} /></label>}
                    <label>Afati i lejes (opsional)<input className="field" name="expires_at" type="date" defaultValue={existing?.expires_at ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(new Date(existing.expires_at).getTime() - 1)) : ""} /></label>
                    <button className="btn btn-primary">Ruaj lejen</button>
                  </ActionForm>
                </article>;
              })}
            </div>

    <details className="detail-block"><summary>Ekzekutimet e fundit</summary>
      {events.error ? <p role="alert">Ekzekutimet nuk u ngarkuan.</p> : events.data?.length ? events.data.map(event => <p key={event.id}>{event.action_key} · {event.status} · {event.created_at}</p>) : <p>Ende nuk ka ekzekutime.</p>}
    </details>
  </>;
}
