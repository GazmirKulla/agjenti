import Link from "next/link";
import { Icon } from "@/components/dashboard/icon";
import { ModuleDescription } from "@/components/dashboard/module-description";
import "@/components/dashboard/actions.css";
import { policyCatalog } from "@/lib/actions/policies";
import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { redirect } from "next/navigation";
import { saveActionPolicy } from "@/lib/actions/manage";
import { createServiceSupabase } from "@/lib/supabase/service";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading } from "@/components/dashboard/ui";
export default async function ActionsPage({ searchParams }: { searchParams?: Promise<{ module?: string }> }) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const db = createServiceSupabase();
  const [global, plans] = await Promise.all([
    db.from("platform_actions").select("*"),
    db.from("plan_actions").select("*"),
  ]);
  if (global.error || plans.error) return <p role="alert">Katalogu nuk u ngarkua. Provo përsëri.</p>;
  const entries = Object.entries(policyCatalog);
  const requested = (await searchParams)?.module;
  const selected = entries.some(([key]) => key === requested) ? requested! : entries[0][0];
  const iconFor = (key: string) => {
    const moduleId = toggleableModules.find(id => key === `module.${id}`);
    return moduleId ? moduleRegistry[moduleId].icon : key === "business.provision" ? "businesses" : key === "product.create" ? "products" : "briefcase";
  };
  return (<>
    <PageHeading eyebrow="Platforma" title="Modulet dhe aftësitë" description="Shiko çfarë bën secili modul dhe zgjidh paketat ku përfshihet." />
    <div className="policy-browser">
      <nav className="policy-module-list" aria-label="Modulet dhe aftësitë">
        <h2>Modulet dhe aftësitë</h2>
        {entries.map(([key, definition]) => (
          <Link key={key} href={`/admin/actions?module=${encodeURIComponent(key)}`} scroll={false}
            className="policy-module-link" aria-current={selected === key ? "page" : undefined}>
            <Icon name={iconFor(key)} size={20} />
            <span>{definition.name}</span>
          </Link>
        ))}
      </nav>
      <div className="policy-module-detail">
        {entries.filter(([key]) => key === selected).map(([key, definition]) => (
          <article
            className="detail-block action-catalog-item"
            key={key}
          >
            <h2 className="policy-module-heading"><Icon name={iconFor(key)} size={24} />{definition.name}</h2>
            {toggleableModules.find(id => key === `module.${id}`) ? <ModuleDescription moduleId={toggleableModules.find(id => key === `module.${id}`)!} /> : <p>{definition.description}</p>}
            <details className="policy-advanced"><summary>Gjendja globale</summary>
            <ActionForm action={saveActionPolicy} className="grid gap-3">
              <input type="hidden" name="scope" value="global" />
              <input type="hidden" name="action_key" value={key} />
              <label>
                Gjendja globale
                <select
                  className="field"
                  name="enabled"
                  defaultValue={String(
                    global.data?.find((x) => x.key === key)?.enabled ?? false,
                  )}
                >
                  <option value="true">Aktiv</option>
                  <option value="false">Çaktivizuar</option>
                </select>
              </label>
              <button className="btn btn-ghost">Ruaj gjendjen</button>
            </ActionForm>
            </details>
            <div className="action-plan-grid">
              {plans.data
                ?.filter((p) => p.action_key === key)
                .map((p) => (
                  <ActionForm
                    key={p.plan}
                    action={saveActionPolicy}
                    className="grid gap-2"
                  >
                    <strong>{p.plan}</strong>
                    <input type="hidden" name="scope" value="plan" />
                    <input type="hidden" name="target" value={p.plan} />
                    <input type="hidden" name="action_key" value={key} />
                    <input type="hidden" name="checkbox_mode" value="true" />
                    <label className="policy-check">
                      <input type="checkbox" name="enabled" value="true" defaultChecked={p.enabled} />
                      Përfshi në paketë
                    </label>
                    {definition.automated && (
                      <label>
                        Krijime / muaj kalendarik (bosh = pa kufi)
                        <input
                          className="field"
                          name="monthly_limit"
                          type="number"
                          min="0"
                          defaultValue={p.monthly_limit ?? ""}
                        />
                      </label>
                    )}
                    <button className="btn btn-ghost">Ruaj paketën</button>
                  </ActionForm>
                ))}
            </div>
          </article>
        ))}
      </div>
    </div>
    </>
  );
}
