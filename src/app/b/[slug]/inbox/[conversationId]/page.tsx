import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { ThreadClient } from "./thread-client";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ slug: string; conversationId: string }>;
}) {
  const { slug, conversationId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const supabase = createServiceSupabase();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id,status,auto_reply,last_inbound_at,business_id")
    .eq("id", conversationId)
    .eq("business_id", access.business.id)
    .maybeSingle();
  if (!conversation) redirect(`/b/${slug}/inbox`);
  const { data: messages } = await supabase
    .from("messages")
    .select("id,direction,source,body,created_at,delivery_status,delivery_error")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const { data: logs } = await supabase
    .from("integration_logs")
    .select("id,target,status,error,created_at")
    .eq("business_id", access.business.id)
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <ThreadClient
      businessId={access.business.id}
      conversationId={conversationId}
      status={conversation.status}
      messages={messages ?? []}
      logs={logs ?? []}
    />
  );
}
