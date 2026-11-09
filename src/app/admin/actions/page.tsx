import Link from "next/link";
import { Icon } from "@/components/dashboard/icon";
import { ModuleDescription } from "@/components/dashboard/module-description";
import "@/components/dashboard/actions.css";
import { policyCatalog } from "@/lib/actions/policies";
import { moduleDependencies, moduleRegistry, navigationOrder, toggleableModules } from "@/lib/dashboard/modules/registry";
import { dependentsOf } from "@/lib/dashboard/modules/dependencies";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { StatusBadge } from "@/components/dashboard/ui";
import type { ModuleId } from "@/lib/dashboard/modules/types";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { redirect } from "next/navigation";
import { saveActionPolicy, saveModulePackages } from "@/lib/actions/manage";
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
  // Modules: every business may use all of them; owners hide optional ones in their settings.
  const { data: businesses } = await db.from("businesses").select("id,name,slug,dashboard_profile").order("name");
  const used = await Promise.all((businesses ?? []).map(async (b) => {
    const { data } = await db.rpc("business_used_modules", { p_business: b.id });
    return [b.id, new Set<string>(Array.isArray(data) ? data : [])] as const;
  }));
  const usedBy = new Map(used);
  const hiddenIn = (id: ModuleId) => (businesses ?? []).filter((b) => {
    const hidden = (b.dashboard_profile as { hiddenModules?: unknown } | null)?.hiddenModules;
    return Array.isArray(hidden) && hidden.includes(id);
  });
  // Only modules that store their own records can show usage.
  const measured = new Set<ModuleId>(["products", "services", "orders", "bookings", "calendar", "catalogs", "knowledge", "customers", "workflows"]);
  const withData = (id: ModuleId) => (businesses ?? []).filter((b) => usedBy.get(b.id)?.has(id));
  const modules = navigationOrder.filter((id) => id !== "staff");
  const requirement = (id: ModuleId) => {
    const rule = moduleDependencies[id];
    const names = (rule.requires ?? rule.requiresAny ?? []).map((dep) => moduleRegistry[dep].label);
    return names.length ? `Kërkon ${names.join(rule.requiresAny ? " ose " : " dhe ")}` : "Pavarur";
  };
  const businessList = (list: { id: string; name: string; slug: string }[], empty: string) => list.length
    ? <ul className="module-business-list">{list.map((b) => <li key={b.id}><Link className="soft-link" href={`/b/${b.slug}`}>{b.name}</Link></li>)}</ul>
    : <p className="muted-copy">{empty}</p>;
  const entries = Object.entries(policyCatalog);
  const requested = (await searchParams)?.module;
  const selected = entries.some(([key]) => key === requested) ? requested! : entries[0][0];
  const iconFor = (key: string) => {
    const moduleId = toggleableModules.find(id => key === `module.${id}`);
    return moduleId ? moduleRegistry[moduleId].icon : key === "business.provision" ? "businesses" : key === "product.create" ? "products" : "briefcase";
  };
  return (<>
    <PageHeading eyebrow="Platforma" title="Modulet dhe aftësitë" description="Modulet që shfaqen në panelin e bizneseve dhe aftësitë që kërkojnë leje të veçantë." />

    <section className="admin-modules" aria-labelledby="admin-modules-title">
      <header className="admin-section-head">
        <div>
          <h2 id="admin-modules-title">Modulet</h2>
          <p className="muted-copy">
            Të gjitha modulet janë të lejuara për çdo biznes. Modulet bazë shfaqen gjithmonë; modulet opsionale
            pronari i fsheh ose i shfaq te Cilësimet → Modulet. Fshehja ndryshon vetëm menunë, jo aftësitë e asistentit.
          </p>
        </div>
        <dl className="admin-module-totals">
          <div><dt>Gjithsej</dt><dd>{modules.length}</dd></div>
          <div><dt>Bazë</dt><dd>{modules.filter((id) => moduleRegistry[id].core).length}</dd></div>
          <div><dt>Opsionale</dt><dd>{modules.filter((id) => toggleableModules.includes(id)).length}</dd></div>
        </dl>
      </header>
      <RecordBrowser
        listTitle="Të gjitha modulet"
        placeholder="Kërko modul…"
        columns={["Moduli", "Lloji", "Varësitë", "Me të dhëna", "E fshehur te"]}
        facets={[{ key: "type", label: "Lloji", options: [{ value: "core", label: "Bazë" }, { value: "optional", label: "Opsional" }] }]}
        records={modules.map((id) => {
          const mod = moduleRegistry[id];
          const optional = toggleableModules.includes(id);
          const dependents = dependentsOf(id);
          return {
            id,
            title: mod.label,
            subtitle: mod.description,
            facets: { type: optional ? "optional" : "core" },
            cells: [
              <StatusBadge key="type" status={optional ? "paused" : "connected"} label={optional ? "Opsional" : "Bazë"} />,
              requirement(id),
              measured.has(id) ? `${withData(id).length} biznese` : "—",
              optional ? `${hiddenIn(id).length} biznese` : "—",
            ],
            detail: <>
              <div className="detail-header">
                <div><h2>{mod.label}</h2><p>/{mod.path || "kreu"}</p></div>
                <span className="icon-tile tone-accent"><Icon name={mod.icon} size={22} /></span>
              </div>
              <div className="detail-block">
                <h3>Përshkrimi</h3>
                <ModuleDescription moduleId={id} />
              </div>
              <div className="detail-block">
                <h3>Si funksionon</h3>
                <dl className="detail-fields">
                  <div><dt>Lloji</dt><dd>{optional ? "Opsional: pronari mund ta fshehë" : "Bazë: shfaqet gjithmonë"}</dd></div>
                  <div><dt>Leja</dt><dd>E lejuar për të gjitha bizneset</dd></div>
                  <div><dt>Varësitë</dt><dd>{requirement(id)}</dd></div>
                  <div><dt>Varen prej tij</dt><dd>{dependents.length ? dependents.map((d) => moduleRegistry[d].label).join(", ") : "Asnjë"}</dd></div>
                  {mod.mobilePriority ? <div><dt>Mobile</dt><dd>Tab kryesor nr. {mod.mobilePriority}</dd></div> : null}
                </dl>
              </div>
              {measured.has(id) ? <div className="detail-block">
                <h3>Biznese me të dhëna ({withData(id).length})</h3>
                {businessList(withData(id), "Asnjë biznes nuk ka ende të dhëna në këtë modul.")}
              </div> : <div className="detail-block">
                <h3>Përdorimi</h3>
                <p className="muted-copy">Ky modul nuk ruan të dhëna të veta, ndaj përdorimi nuk matet.</p>
              </div>}
              {optional && <div className="detail-block">
                <h3>E fshehur te ({hiddenIn(id).length})</h3>
                {businessList(hiddenIn(id), "Asnjë biznes nuk e ka fshehur.")}
              </div>}
            </>,
          };
        })}
      />
    </section>

    <section className="admin-capabilities" aria-labelledby="admin-capabilities-title">
      <header className="admin-section-head">
        <div>
          <h2 id="admin-capabilities-title">Aftësitë e veçanta</h2>
          <p className="muted-copy">Aftësi që kërkojnë leje të veçantë: gjendja globale dhe paketat ku përfshihen. Një biznes mund të ketë leje specifike te Bizneset → Lejet.</p>
        </div>
      </header>
    <div className="policy-browser">
      <nav className="policy-module-list" aria-label="Aftësitë e veçanta">
        <h2>Aftësitë e veçanta</h2>
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
            <ActionForm action={saveModulePackages} className="policy-package-form">
              <input type="hidden" name="action_key" value={key} />
              <h3>Paketat</h3>
              <div className="policy-package-list">
                {["free", "starter", "professional", "enterprise"].map(plan => {
                  const policy = plans.data?.find(p => p.action_key === key && p.plan === plan);
                  return <div className="policy-package-row" key={plan}>
                    <label className="policy-check">
                      <input type="checkbox" name={`plan_${plan}`} defaultChecked={policy?.enabled ?? false} />
                      <span>{plan}</span>
                    </label>
                    {definition.automated && <label className="policy-package-limit">
                      Krijime në muaj (bosh = pa kufi)
                      <input className="field" name={`limit_${plan}`} type="number" min="0" defaultValue={policy?.monthly_limit ?? ""} />
                    </label>}
                  </div>;
                })}
              </div>
              <button className="btn btn-primary" type="submit">Ruaj</button>
            </ActionForm>
          </article>
        ))}
      </div>
    </div>
    </section>
    </>
  );
}
