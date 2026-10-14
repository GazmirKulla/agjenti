import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { buildNavigationItems } from "@/lib/dashboard/navigation/builder";
import { organizeWorkspace } from "@/lib/dashboard/navigation/workspace";
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
  const links = navigation.search.filter((item, index, all) => item.path && item.path !== "inbox" && all.findIndex(other => other.path === item.path) === index);
  return <div className="mobile-business-hub">
    <div className="page-heading"><h1>Biznesi</h1><p>{access.business.name} · Menaxho drejtpërdrejt çdo pjesë të biznesit.</p></div>
    <nav className="business-hub-links" aria-label="Menaxhimi i biznesit">{links.map(item => <Link key={item.path} href={`/b/${slug}/${item.path}`}><Icon name={item.icon}/><span>{item.label}</span><span aria-hidden>↗</span></Link>)}</nav>
    <details className="business-hub-overview"><summary>Përmbledhja e biznesit</summary><Overview compact business={access.business} dashboardProfile={profile}/></details>
  </div>;
}
