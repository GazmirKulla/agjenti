import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { ChatLab } from "@/components/chat-lab/chat-lab";

export default async function ChatLabPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  return <ChatLab />;
}
