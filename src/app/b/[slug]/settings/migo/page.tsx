// Compatibility for saved links; no separate assistant identity or settings form.
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
export default async function LegacyAssistantSettings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  redirect(`/b/${access.business.slug}/settings/assistant`);
}
