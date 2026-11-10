import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { loadManagementSummary } from "@/lib/dashboard/management-summary";
import { buildNavigationItems } from "@/lib/dashboard/navigation/builder";
import { businessWorkspaceGroups, organizeWorkspace, workspaceLabel } from "@/lib/dashboard/navigation/workspace";
import { Icon } from "@/components/dashboard/icon";
import { loadItemSetup } from "@/lib/items/business";
import { Overview } from "@/components/dashboard/overview";
import { ManagementSummary } from "@/components/dashboard/management-summary";
import s from "@/components/dashboard/management.module.css";

export default async function BusinessHub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const profile = await loadDashboardProfile(access.business.id);
  const modules = profile.enabledModules;
  // The directory includes permitted destinations even if the owner hides sidebar links.
  const items = await loadItemSetup(access.business.id);
  const navigation = organizeWorkspace(buildNavigationItems({ ...profile, navigationItems: modules }, "desktop", { products: items.names.plural }));
  const groups = businessWorkspaceGroups(navigation);
  const summary = await loadManagementSummary(access.business.id, modules);
  const base = `/b/${access.business.slug}`;
  return <div className={s.page}>
    <header className={s.header}><small>{access.business.name}</small><h1>Menaxhimi</h1><p>Puna e përditshme, oferta dhe konfigurimi i biznesit.</p>
      <nav className={s.actions} aria-label="Veprime të shpejta">
        {modules.includes("products") && access.business.catalog_source !== "external" && <Link className="btn btn-primary" href={`${base}/products/new`}>＋ Shto {items.names.singular}</Link>}
        {modules.includes("services") && <Link className="btn btn-ghost" href={`${base}/services`}>Menaxho shërbimet</Link>}
        {modules.includes("bookings") && <Link className="btn btn-ghost" href={`${base}/bookings`}>Hap rezervimet</Link>}
      </nav>
    </header>
    <ManagementSummary base={base} modules={modules} summary={summary}/>
    <section className={s.directory} aria-labelledby="management-sections"><h2 id="management-sections">Seksionet e biznesit</h2>
      <p>Hyr drejtpërdrejt, edhe kur një seksion është bosh ose e ke fshehur nga menuja.</p>
      <nav className={s.groups} aria-label="Menaxhimi i biznesit">{groups.map(group => <section key={group.id} className={`${s.panel} ${s.group}`}>
        <h3>{group.label}</h3><p>{group.description}</p>
        <div className={s.links}>{group.items.map(item => <Link key={item.path} href={`${base}/${item.path}`}><Icon name={item.icon} size={18}/><span>{workspaceLabel(item)}</span><span aria-hidden="true">↗</span></Link>)}</div>
      </section>)}</nav>
    </section>
    <nav className={s.utilities} aria-label="Konfigurime të tjera">
      {modules.includes("customers") && <Link href={`${base}/customers`}>Klientët →</Link>}
      <Link href={`${base}/settings/business`}>Profili i biznesit →</Link>
      <Link href={`${base}/settings/modules`}>Përshtat menunë →</Link>
      <Link href={`${base}/setup`}>Onboarding →</Link>
      {modules.includes("workflows") && <Link href={`${base}/workflows`}>Workflow Designer · prova dhe versione →</Link>}
      <Link href={`${base}/settings/advanced`}>Mjete të avancuara →</Link>
    </nav>
    <details className="business-hub-overview"><summary>Aktiviteti dhe përmbledhja e biznesit</summary><Overview compact business={access.business} dashboardProfile={profile}/></details>
  </div>;
}
