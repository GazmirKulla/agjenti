import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { PageHeading } from "@/components/dashboard/ui";
import { AgentCapabilities } from "@/components/agents/capabilities";

export const metadata = { title: "Çfarë bën Agjenti | Agjenti.app" };

/** Every capability on one page: kept for older links; the topics (Porositë, Rezervimet, Komunikimi) show their own part. */
export default async function AgentProcessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  return <>
    <PageHeading title="Çfarë bën Agjenti" description="Çdo gjë që bën Agjenti me klientët, në një vend. Të njëjtat cilësime janë edhe te temat Porositë, Rezervimet dhe Komunikimi." />
    <AgentCapabilities slug={slug} businessId={access.business.id} sections={["orders", "orderStatus", "bookings", "bookingChanges", "handoff", "voice", "notes"]} />
  </>;
}
