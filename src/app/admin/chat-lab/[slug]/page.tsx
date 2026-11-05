import { notFound, redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin, requireBusinessAccess } from "@/lib/tenant/access";

/** Preserve old bookmarks without maintaining a second chat interface. */
export default async function LabConversationPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ draft?: string }>;
}) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const { slug } = await params;
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) notFound();
  const { draft } = await searchParams;
  const query = new URLSearchParams({ business: access.business.id });
  if (draft) query.set("draft", draft);
  redirect(`/admin/chat-lab?${query}`);
}
