import { redirect } from "next/navigation";
import { InboxWorkspace } from "@/components/dashboard/inbox-workspace";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function ConversationCustomerPage({
  params,
}: {
  params: Promise<{ slug: string; conversationId: string }>;
}) {
  const { slug, conversationId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");

  return (
    <InboxWorkspace
      businessId={access.business.id}
      slug={slug}
      conversationId={conversationId}
      view="customer"
    />
  );
}
