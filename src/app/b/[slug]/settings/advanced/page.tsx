import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { buildNavigationItems } from "@/lib/dashboard/navigation/builder";
import { organizeWorkspace } from "@/lib/dashboard/navigation/workspace";
import { DeleteBusinessPanel } from "@/components/dashboard/delete-business";
import s from "@/components/settings/settings.module.css";

export default async function AdvancedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const profile = await loadDashboardProfile(access.business.id);
  const navigation = organizeWorkspace(buildNavigationItems(profile, "desktop"));
  const links = navigation.agent.filter(item => ["workflows", "agent-memory", "agent-test"].includes(item.id));
  return <>
    <section className={s.section}><h2>Mjete të avancuara</h2><p>Editorët dhe provat ekzistuese. Hapja e tyre nuk ndryshon dhe nuk publikon asnjë rrjedhë.</p>
      <nav className={s.links} aria-label="Mjete të avancuara">
        {links.map(item => <Link key={item.id} href={`/b/${access.business.slug}/${item.path}`}>{item.id === "workflows" ? "Workflow Designer" : item.label} →</Link>)}
        <Link href={`/b/${access.business.slug}/setup`}>Konfigurimi fillestar →</Link>
        {navigation.settings.filter(item => item.id === "staff").map(item => <Link key={item.id} href={`/b/${access.business.slug}/${item.path}`}>{item.label} →</Link>)}
      </nav>
    </section>
    <DeleteBusinessPanel businessId={access.business.id} slug={access.business.slug} businessName={access.business.name} redirectTo="/auth/continue"/>
  </>;
}
