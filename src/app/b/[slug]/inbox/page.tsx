import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { InboxWorkspace } from "@/components/dashboard/inbox-workspace";
import { leadFilter } from "@/lib/leads/model";
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lead?: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  return <InboxWorkspace businessId={access.business.id} slug={slug} lead={leadFilter((await searchParams).lead)} />;
}
