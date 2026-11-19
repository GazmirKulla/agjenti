import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadTeam } from "@/lib/team/service";
import { TeamPanel } from "@/components/team/team-panel";

export const metadata = { title: "Ekipi | Agjenti.app" };

/** Cilësimet → Ekipi: the business's members and roles; owners invite, change roles and remove. */
export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const team = await loadTeam(access.business.id, user.id).catch(() => null);
  return <>
    <PageHeading eyebrow="Cilësimet" title="Ekipi" description="Kush punon në këtë biznes dhe me çfarë roli. Pronari fton, ndryshon rolet dhe heq anëtarët." />
    {team ? <TeamPanel slug={access.business.slug} members={team.members} invitations={team.invitations} owner={team.owner} />
      : <section className="panel section-pad"><p className="muted-copy">Ekipi nuk u lexua. Rifresko faqen.</p></section>}
  </>;
}
