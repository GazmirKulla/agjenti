import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { AgentSpace } from "@/components/agents/agent-space";
import { TopicTest } from "@/components/agents/topic-test";
import { AgentCapabilities } from "@/components/agents/capabilities";
import { ServicesSummary } from "@/components/agents/offer-summary";
import { ConfigurationHistory } from "@/components/agents/configuration-history";

export const metadata = { title: "Kur klienti rezervon | Agjenti.app" };

/** Agjenti → Kur klienti rezervon: what the agent does for this topic and what is missing, with the test beside it. */
export default async function AgentBookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  return <>
    <PageHeading title="Kur klienti rezervon" description="Çfarë bën Agjenti kur një klient do të rezervojë: nëse rezervon vetë, për cilat shërbime dhe si i ndryshon rezervimet. Orari i rezervimeve është te Rezervimet → Orari, kohëzgjatja te Shërbimet." />
    <AgentSpace test={<TopicTest slug={access.business.slug} businessId={access.business.id} businessName={access.business.name} userId={user.id} />}>
      <ServicesSummary slug={access.business.slug} businessId={access.business.id} />
      <AgentCapabilities slug={access.business.slug} businessId={access.business.id} sections={["bookings", "bookingChanges"]} />
      {/* Handing the conversation to staff applies to every topic: it lives in one place. */}
      <p className="muted-copy topic-handoff-link">Kur Agjenti ia kalon bisedën stafit dhe çfarë i thotë klientit: <Link className="inline-link" href={`/b/${access.business.slug}/agents#capability-handoff`}>Si flet dhe kur thërret stafin →</Link></p>
      <ConfigurationHistory slug={access.business.slug} businessId={access.business.id} />
    </AgentSpace>
  </>;
}
