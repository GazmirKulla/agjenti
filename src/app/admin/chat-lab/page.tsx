import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { ChatLab } from "@/components/chat-lab/chat-lab";

export default async function ChatLabPage({ searchParams }: { searchParams: Promise<{ business?: string; draft?: string }> }) {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const query = await searchParams;
  return <ChatLab userId={user.id} initialBusiness={query.business} initialDraft={query.draft} />;
}
