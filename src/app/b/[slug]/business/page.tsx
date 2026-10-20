import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { buildNavigationItems } from "@/lib/dashboard/navigation/builder";
import { businessWorkspaceGroups, organizeWorkspace } from "@/lib/dashboard/navigation/workspace";
import { Icon } from "@/components/dashboard/icon";
import { Overview } from "@/components/dashboard/overview";

export default async function BusinessHub({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const profile = await loadDashboardProfile(access.business.id);
  const navigation = organizeWorkspace(buildNavigationItems(profile, "desktop"));
  const groups = businessWorkspaceGroups(navigation);
  return <div className="mobile-business-hub">
    <div className="page-heading"><h1>Biznesi</h1><p>{access.business.name} · Çfarë ofron, çfarë di dhe si komunikon agjenti me klientët.</p></div>
    <nav className="business-hub-groups" aria-label="Menaxhimi i biznesit">{groups.map(group =>
      <details key={group.id} className="business-hub-group">
        <summary><span><strong>{group.label}</strong><small>{group.description}</small></span><span aria-hidden>⌄</span></summary>
        <div className="business-hub-links">{group.items.map(item => <Link key={item.path} href={`/b/${slug}/${item.path}`}><Icon name={item.icon}/><span>{item.id === "agents" ? "Agjenti i klientëve" : item.label}</span><span aria-hidden>↗</span></Link>)}</div>
      </details>)}</nav>
    <div className="business-hub-utilities">
      <Link href={`/b/${slug}/settings/business`}>Profili dhe cilësimet e biznesit →</Link>
      <Link href={`/b/${slug}/setup`}>Onboarding →</Link>
      <details><summary>Avancuar</summary>
        {navigation.agent.some(item => item.id === "workflows") && <Link href={`/b/${slug}/workflows`}>Workflow Designer · prova dhe versione →</Link>}
        <Link href={`/b/${slug}/settings/advanced`}>Mjete të avancuara →</Link>
      </details>
    </div>
    <details className="business-hub-overview"><summary>Përmbledhja e biznesit</summary><Overview compact business={access.business} dashboardProfile={profile}/></details>
  </div>;
}
