import "@/components/dashboard/actions.css";
import Link from "next/link";
import { policyCatalog } from "@/lib/actions/policies";
import { toggleableModules } from "@/lib/dashboard/modules/registry";
import { loadAllowedModules } from "@/lib/dashboard/modules/entitlements";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { redirect } from "next/navigation";
import { saveActionPolicy } from "@/lib/actions/manage";
import { createServiceSupabase } from "@/lib/supabase/service";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading } from "@/components/dashboard/ui";
export default async function ActionsPage({ searchParams }: { searchParams?: Promise<{ business?: string }> }) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const selected = (await searchParams)?.business;
  const db = createServiceSupabase();
  const [global, plans, businesses, overrides, events] = await Promise.all([
    db.from("platform_actions").select("*"),
    db.from("plan_actions").select("*"),
    db.from("businesses").select("id,name,slug").order("name"),
    db.from("business_actions").select("*"),
    db
      .from("action_executions")
      .select("id,business_id,action_key,status,created_at")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if ([global, plans, businesses, overrides, events].some((r) => r.error))
    return (
      <p role="alert">
        Katalogu nuk u ngarkua. Kontrollo migrimin e veprimeve dhe lidhjen me
        databazën.
      </p>
    );
  const business = businesses.data?.find(b => b.id === selected) ?? businesses.data?.[0];
  const [allowed, profile, provision] = business ? await Promise.all([
    loadAllowedModules(business.id), loadDashboardProfile(business.id),
    db.rpc("can_execute_business_action", { p_business: business.id, p_user: user.id, p_action: "business.provision", p_automated: false }),
  ]) : [[], null, null];
  const allowedModules = new Set(allowed);
  return (
    <>
      <PageHeading
        eyebrow="Platforma"
        title="Modulet dhe aftësitë"
        description="Përcakto çfarë mund të përdorë pronari në çdo biznes. Aktivizimi në hapësirë nuk tejkalon këto leje."
      />
      <div className="grid gap-6">
        <section className="detail-block">
          <h2>Lejet për biznes</h2>
          <form action="/admin/actions" className="flex flex-wrap gap-3 items-end">
            <label>Biznesi<select className="field" name="business" defaultValue={business?.id}>
              {businesses.data?.map(b => <option value={b.id} key={b.id}>{b.name} · /{b.slug}</option>)}
            </select></label><button className="btn btn-ghost">Shfaq lejet</button>
          </form>
          {business && <>
            <p>Biznesi: <strong>{business.name}</strong>. “Sipas paketës” përdor lejen e paketës; bllokimi global dhe varësitë e moduleve kanë përparësi.</p>
            <div className="capability-grid">
              {["business.provision", ...toggleableModules.map(id => `module.${id}`)].map(key => {
                const definition = policyCatalog[key];
                const existing = overrides.data?.find(o => o.business_id === business.id && o.action_key === key);
                const moduleId = toggleableModules.find(id => key === `module.${id}`);
                const allowed = moduleId ? allowedModules.has(moduleId) : provision?.data === true;
                return <article className="capability-card" key={`${business.id}:${key}`}>
                  <h3>{definition.name}</h3><p>{definition.description}</p>
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
            <Link className="soft-link" href={`/b/${business.slug}/actions`}>Hap aftësitë e biznesit →</Link>
          </>}
        </section>
        <h2>Rregullat globale dhe paketat</h2>
        {Object.entries(policyCatalog).map(([key, definition]) => (
          <details
            className="detail-block action-catalog-item"
            key={key}
          >
            <summary>
              <h2>{definition.name}</h2>
            </summary>
            <p>{definition.description}</p>
            <p className="muted-copy">
              {definition.automated
                ? "Manual dhe workflow"
                : key.startsWith("module.") ? "Akses në modulin e hapësirës" : "Leje shtesë për krijimin brenda modulit"}{" "}
              · Versioni {definition.version}
            </p>
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
            <h3>Paketat</h3>
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
                    <label>
                      Akses
                      <select
                        className="field"
                        name="enabled"
                        defaultValue={String(p.enabled)}
                      >
                        <option value="true">Lejohet</option>
                        <option value="false">Nuk përfshihet</option>
                      </select>
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
            <h3>Përjashtim për biznes</h3>
            <ActionForm action={saveActionPolicy} className="grid gap-3">
              <input type="hidden" name="scope" value="business" />
              <input type="hidden" name="action_key" value={key} />
              <label>
                Biznesi
                <select className="field" name="target" required>
                  {businesses.data?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Akses
                <select className="field" name="enabled">
                  <option value="inherit">Sipas paketës</option>
                  <option value="true">Lejo veçmas</option>
                  <option value="false">Blloko</option>
                </select>
              </label>
              {definition.automated && (
                <label>
                  Kufi mujor (bosh = sipas paketës)
                  <input
                    className="field"
                    name="monthly_limit"
                    type="number"
                    min="0"
                  />
                </label>
              )}
              <label>
                I vlefshëm deri më (ora e Tiranës, opsionale)
                <input className="field" type="date" name="expires_at" />
              </label>
              <button className="btn btn-primary">Ruaj përjashtimin</button>
            </ActionForm>
            {overrides.data
              ?.filter((o) => o.action_key === key)
              .map((o) => (
                <p key={o.business_id}>
                  {businesses.data?.find((b) => b.id === o.business_id)?.name}:{" "}
                  {o.enabled === null
                    ? "Sipas paketës"
                    : o.enabled
                      ? "Lejohet"
                      : "Bllokuar"}{" "}
                  · kufiri {o.monthly_limit ?? "sipas paketës"}{" "}
                  {o.expires_at ? `· deri ${o.expires_at}` : ""}
                </p>
              ))}
          </details>
        ))}
        <section className="detail-block">
          <h2>Ekzekutimet e fundit</h2>
          {!events.data?.length && <p>Ende nuk ka ekzekutime.</p>}
          {events.data?.map((e) => (
            <p key={e.id}>
              {businesses.data?.find((b) => b.id === e.business_id)?.name} ·{" "}
              {e.action_key} · {e.status} · {e.created_at}
            </p>
          ))}
        </section>
        <section className="detail-block">
          <h2>Konfigurimet e bizneseve</h2>
          {businesses.data?.map((b) => (
            <p key={b.id}>
              <Link href={`/b/${b.slug}/actions`}>{b.name} →</Link>
            </p>
          ))}
        </section>
      </div>
    </>
  );
}
