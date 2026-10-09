import { redirect } from "next/navigation";
import { AccountDetails } from "@/components/account/details";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function BusinessAccountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user || !(await requireBusinessAccess(user.id, slug))) redirect("/auth/continue");
  return <AccountDetails />;
}
