import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { ThreadClient } from "@/app/b/[slug]/inbox/[conversationId]/thread-client";
import { InboxList } from "./inbox-list";
import { EmptyState, PageHeading, StatusBadge, formatDate, money } from "./ui";
export async function InboxWorkspace({
  businessId,
  slug,
  conversationId,
}: {
  businessId: string;
  slug: string;
  conversationId?: string;
}) {
  const db = createServiceSupabase();
  const { data: rows, error } = await db
    .from("conversations")
    .select(
      "id,status,last_message_preview,unread_count,customers(display_name,username)",
    )
    .eq("business_id", businessId)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Nuk u ngarkuan bisedat.");
  const selected = conversationId || rows?.[0]?.id;
  const heading = (
    <PageHeading
      title="Inbox"
      description="Menaxho bisedat nga Instagram dhe ndiq porositë e klientëve."
    />
  );
  if (!selected)
    return (
      <>
        {heading}
        <section className="panel">
          <EmptyState
            title="Inbox-i yt është gati"
            description="Lidh Instagram-in për të marrë mesazhet e para të klientëve."
          />
          <Link
            className="soft-link mx-auto mb-6 w-fit"
            href={`/b/${slug}/instagram`}
          >
            Menaxho Instagram →
          </Link>
        </section>
      </>
    );
  const { data: conversation, error: conversationError } = await db
    .from("conversations")
    .select(
      "id,status,customer_id,customers(display_name,username,phone,created_at)",
    )
    .eq("business_id", businessId)
    .eq("id", selected)
    .maybeSingle();
  if (conversationError) throw new Error("Nuk u ngarkua biseda.");
  if (!conversation) notFound();
  const [messageResult, orderResult, logResult] = await Promise.all([
    db
      .from("messages")
      .select(
        "id,direction,source,body,media,created_at,delivery_status,delivery_error",
      )
      .eq("business_id", businessId)
      .eq("conversation_id", selected)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("orders")
      .select("id,status,total_amount,currency,created_at")
      .eq("business_id", businessId)
      .eq("customer_id", conversation.customer_id)
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("integration_logs")
      .select("id,target,status,error,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  if (messageResult.error || orderResult.error || logResult.error)
    throw new Error("Nuk u ngarkuan detajet e bisedës.");
  const customer = conversation.customers as unknown as {
    display_name: string | null;
    username: string | null;
    phone: string | null;
    created_at: string;
  } | null;
  const name =
    customer?.display_name || customer?.username || "Klient Instagram";
  return (
    <>
      {heading}
      <div className="inbox-workspace">
        <InboxList
          slug={slug}
          selected={selected}
          rows={(rows ?? []).map((r) => {
            const c = r.customers as unknown as {
              display_name: string | null;
              username: string | null;
            } | null;
            return {
              id: r.id,
              status: r.status,
              name: c?.display_name || c?.username || "Klient Instagram",
              preview: r.last_message_preview,
              unread: r.unread_count,
            };
          })}
        />
        <ThreadClient
          key={selected}
          businessId={businessId}
          conversationId={selected}
          status={conversation.status}
          customerName={name}
          messages={(messageResult.data ?? []).reverse()}
          logs={logResult.data ?? []}
        />
        <aside className="inbox-customer">
          <section className="panel section-pad">
            <h2 className="text-base mb-5">Informacioni i klientit</h2>
            <div className="flex items-center gap-3 mb-6">
              <span className="profile-avatar">
                {name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <h3>{name}</h3>
                <p className="muted-copy">
                  {customer?.username ? `@${customer.username}` : "Instagram"}
                </p>
              </div>
            </div>
            <dl className="detail-fields">
              <div>
                <dt>Emri</dt>
                <dd>{customer?.display_name || "—"}</dd>
              </div>
              <div>
                <dt>Telefoni</dt>
                <dd>{customer?.phone || "—"}</dd>
              </div>
              <div>
                <dt>Klient që nga</dt>
                <dd>{formatDate(customer?.created_at ?? null)}</dd>
              </div>
            </dl>
          </section>
          <section className="panel section-pad">
            <h2 className="text-base mb-4">Porositë e klientit</h2>
            {orderResult.data?.length ? (
              orderResult.data.map((o) => (
                <Link
                  className="customer-order"
                  key={o.id}
                  href={`/b/${slug}/orders`}
                >
                  <div>
                    <strong>#{o.id.slice(0, 8)}</strong>
                    <StatusBadge status={o.status} />
                  </div>
                  <p>
                    {formatDate(o.created_at)}
                    <strong>{money(o.total_amount, o.currency)}</strong>
                  </p>
                </Link>
              ))
            ) : (
              <p className="muted-copy">Ky klient ende nuk ka porosi.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
