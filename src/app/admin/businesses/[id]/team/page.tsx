import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadTeam } from "@/lib/team/service";
import { TeamPanel } from "@/components/team/team-panel";

export const metadata = { title: "Ekipi i biznesit | Agjenti.app" };

/** Platform Admin: a business's members and roles, and invitation links for people not registered yet. */
export default async function AdminBusinessTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const { data: business } = await createServiceSupabase().from("businesses").select("id,name,slug").eq("id", id).maybeSingle();
  if (!business) notFound();
  const team = await loadTeam(business.id, user.id).catch(() => null);
  return <>
    <PageHeading eyebrow="PLATFORMA · BIZNESET" title={`Ekipi i ${business.name}`}
      description="Anëtarët dhe rolet e këtij biznesi. Fto me lidhje dikë që nuk është regjistruar ende; e pranon vetëm emaili i ftuar, i konfirmuar.">
      <Link className="soft-link" href="/admin/businesses">← Bizneset</Link>
    </PageHeading>
    {team ? <TeamPanel slug={business.slug} members={team.members} invitations={team.invitations} owner={team.owner} />
      : <section className="panel section-pad"><p className="muted-copy">Ekipi nuk u lexua.</p></section>}
  </>;
}
