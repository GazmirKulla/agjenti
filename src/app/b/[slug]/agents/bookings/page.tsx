import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { AgentSpace } from "@/components/agents/agent-space";
import { TopicTest } from "@/components/agents/topic-test";
import { AgentCapabilities } from "@/components/agents/capabilities";
import { ConfigurationHistory } from "@/components/agents/configuration-history";

export const metadata = { title: "Rezervimet | Agjenti.app" };

/** Agjenti → Rezervimet: what the agent does for this topic and what is missing, with the test beside it. */
export default async function AgentBookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  return <>
    <PageHeading title="Rezervimet" description="Çfarë bën Agjenti kur një klient do të rezervojë: nëse rezervon vetë, për cilat shërbime, si i ndryshon rezervimet dhe kur ia kalon stafit. Orari i rezervimeve është te Kalendari, kohëzgjatja te Shërbimet." />
    <AgentSpace test={<TopicTest slug={access.business.slug} businessId={access.business.id} businessName={access.business.name} userId={user.id} />}>
      <AgentCapabilities slug={access.business.slug} businessId={access.business.id} sections={["bookings", "bookingChanges", "handoff"]} />
      <ConfigurationHistory slug={access.business.slug} businessId={access.business.id} />
    </AgentSpace>
  </>;
}
