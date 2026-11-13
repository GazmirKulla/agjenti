import { getDashboardTranslator } from "@/lib/dashboard/language/server";
import { InboxRefresh } from "./inbox-refresh";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadInboxRows, loadThreadConversation, loadThreadMessages, type InboxRow, type ThreadConversation } from "@/lib/conversations/inbox-read";
import { createServiceSupabase } from "@/lib/supabase/service";
import { ThreadClient } from "@/app/b/[slug]/inbox/[conversationId]/thread-client";
import { getSessionUser } from "@/lib/tenant/access";
import { ConversationPanel } from "./conversation-panel";
import { loadConversationContext } from "@/lib/conversations/context";
import { InboxList } from "./inbox-list";
import { EmptyState, PageHeading } from "./ui";

export async function InboxWorkspace({
  businessId,
  slug,
  conversationId,
  view,
}: {
  businessId: string;
  slug: string;
  conversationId?: string;
  view?: "customer";
}) {
  const t = await getDashboardTranslator();
  const user = await getSessionUser();
  if (!user) notFound();
  const db = createServiceSupabase();
  const [instagram, whatsapp] = await Promise.all([
    db.from("instagram_connections").select("status,expires_at").eq("business_id", businessId).neq("status", "disconnected").maybeSingle(),
    db.from("whatsapp_connections").select("status").eq("business_id", businessId).maybeSingle(),
  ]);
  const channels = (["instagram", "whatsapp"] as const).map(channel => {
    const result = channel === "instagram" ? instagram : whatsapp;
    const expired = channel === "instagram" && instagram.data?.expires_at && Date.parse(instagram.data.expires_at) <= Date.now();
    return {
      channel,
      connected: !result.error && result.data?.status === "connected" && !expired,
      status: result.error ? t("Statusi nuk u ngarkua") : expired ? t("Kërkon rilidhje") : result.data?.status === "connected" ? t("I lidhur") : t("I palidhur"),
    };
  });
  let inboxRows: InboxRow[];
  try { inboxRows = await loadInboxRows(db, businessId); }
  catch { throw new Error(t("Nuk u ngarkuan bisedat.")); }
  const selected = conversationId;
  const heading = (
    <PageHeading
      title="Inbox"
      description={t("Menaxho bisedat nga Instagram dhe WhatsApp dhe ndiq porositë e klientëve.")}
    />
  );
  if (!selected)
    return (
      <>
        {heading}
        <InboxRefresh title="Inbox" />
        <div className="inbox-workspace inbox-list-home">
          <InboxList rows={inboxRows} slug={slug} channels={channels} />
          <section className="panel chat-panel">
            <EmptyState
              title={t(inboxRows.length ? "Zgjidh një bisedë" : "Inbox-i yt është gati")}
              description={t(inboxRows.length
                ? "Zgjidh një bisedë nga lista për të parë mesazhet."
                : "Lidh Instagram-in ose WhatsApp-in për të marrë mesazhet e para të klientëve.")}
            />
            {!inboxRows.length && (
              <Link className="soft-link mx-auto mb-6 w-fit" href={`/b/${slug}/integrations`}>
                {t("Menaxho integrimet →")}
              </Link>
            )}
          </section>
          <aside className="inbox-customer">
            <section className="panel section-pad">
              <h2 className="text-base mb-5">{t("Informacioni i klientit")}</h2>
              <p className="muted-copy">{t("Zgjidh një bisedë për të parë detajet e klientit.")}</p>
            </section>
          </aside>
        </div>
      </>
    );
  let conversation: ThreadConversation | null;
  try { conversation = await loadThreadConversation(db, businessId, selected); }
  catch { throw new Error(t("Nuk u ngarkua biseda.")); }
  if (!conversation) notFound();

  const [messageResult, contextResult, logResult] = await Promise.all([
    loadThreadMessages(db, businessId, selected).then(
      (data) => ({ data, error: null }),
      (error: unknown) => ({ data: null, error }),
    ),
    loadConversationContext(db, businessId, selected).then(
      (data) => ({ data, error: null }),
      (error: unknown) => ({ data: null, error }),
    ),
    db
      .from("integration_logs")
      .select("id,target,status,error,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  if (messageResult.error || logResult.error)
    throw new Error(t("Nuk u ngarkuan detajet e bisedës."));

  const { name } = conversation;

  return (
    <>
      {heading}
        <InboxRefresh title={name} />
      <div
        className={`inbox-workspace ${conversationId ? "has-selection" : "inbox-list-home"} ${view === "customer" ? "is-mobile-customer" : ""}`}
      >
        <InboxList
          channels={channels}
          slug={slug}
          selected={selected}
          rows={inboxRows}
        />
        <ThreadClient
          key={`${user.id}:${selected}`}
          userId={user.id}
          businessId={businessId}
          conversationId={selected}
          slug={slug}
          status={conversation.status}
          channel={conversation.channel}
          lastInboundAt={conversation.last_inbound_at}
          customerName={name}
          messages={messageResult.data ?? []}
          pendingOrder={Boolean(contextResult.data?.pendingOrder)}
          canOrder={Boolean(contextResult.data?.forms.order.enabled)}
          canBook={Boolean(contextResult.data?.forms.booking.enabled && contextResult.data.forms.booking.services.length)}
          logs={logResult.data ?? []}
        />
        <aside className="inbox-customer">
          <div className="inbox-customer-mobile-header">
            <Link
              href={`/b/${slug}/inbox/${selected}`}
              aria-label={t("Kthehu te biseda")}
            >
              ‹
            </Link>
            <strong>{t("Klienti dhe biseda")}</strong>
            <span aria-hidden="true">⋮</span>
          </div>
          {contextResult.data ? (
            <ConversationPanel context={contextResult.data} businessId={businessId} slug={slug} />
          ) : (
            <section className="panel section-pad">
              <p className="muted-copy" role="alert">{t("Detajet e bisedës nuk u ngarkuan. Rifresko faqen.")}</p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
