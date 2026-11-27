import Link from "next/link";
import { ParticipantAvatar } from "@/components/dashboard/participant-avatar";
import { participantAvatarUrl } from "@/lib/conversations/participant-avatar";
import { refusalText } from "@/lib/orders/dispatch-detail";
import { orderDelivery } from "@/lib/customers/contact";
import { OrderEditor } from "@/components/dashboard/order-editor";
import { WebsiteStatusControl } from "@/components/dashboard/website-status-control";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { OrderOutputPhotos } from "@/components/dashboard/order-output-photos";
import { Icon } from "@/components/dashboard/icon";
import { readBusinessFields, type BusinessField } from "@/lib/items/fields";
import {
  PageHeading,
  StatusBadge,
  formatDate,
  money,
} from "@/components/dashboard/ui";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { requireEnabledModule } from "@/lib/dashboard/modules/permissions";
import { loadOrderStockMovements } from "@/lib/products/stock-history";
import { stockReasonLabels } from "@/lib/products/stock";

const ORDER_STATUSES = [
  ["draft", "Draft"],
  ["confirmed", "Të konfirmuara"],
  ["submitted", "Të përcjella"],
  ["failed", "Të dështuara"],
  ["pending_reconciliation", "Për verifikim nga stafi"],
] as const;

type OrderItemRow = {
  id: string; quantity: number | string; unit_amount: number | string | null; options: Record<string, unknown> | null;
  position: number | null; products: { name: string } | null;
};

/** The business's name for a stored choice key: a variant (variant_<key>), a customer question (ask_<key>) or a field. */
function choiceLabel(key: string, fields: BusinessField[]) {
  const own = key.replace(/^(variant_|ask_)/, "");
  return fields.find(f => f.key === own)?.label ?? key;
}
/** Every item of the order in the order it was written, with its readable choices. */
function orderLines(rows: OrderItemRow[] | null, fields: BusinessField[] = []) {
  return [...(rows ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row) => {
      const quantity = Number(row.quantity);
      const unit = row.unit_amount == null ? null : Number(row.unit_amount);
      const choices = Object.entries(row.options ?? {})
        .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) && String(value).trim())
        .map(([key, value]) => ({ key, label: choiceLabel(key, fields), value: value === true ? "po" : String(value) }));
      return { id: row.id, name: row.products?.name ?? "Produkt i hequr", quantity, unit,
        total: unit == null ? null : Math.round(unit * quantity * 100) / 100, choices };
    });
}

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  const { slug } = await params;
  const { order: openOrder } = await searchParams;
  await requireEnabledModule(slug, "orders");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  let { data: orders, error } = await db.from("orders")
    .select("id,order_number,status,total_amount,currency,external_order_id,external_system,external_status,external_status_label,created_at,order_submissions(rejection),delivery:payload->customer,note:payload->note,customers(display_name,username,phone),conversations(id,business_id,participant_avatar_path,participant_avatar_checked_at),order_items(id,quantity,unit_amount,options,position,products(name))")
    .eq("business_id", access.business.id).order("created_at", { ascending: false }).limit(1000);
  // Before migration 20261120140000 the refusal is not there yet; the orders still load without it.
  if (error) ({ data: orders, error } = await db.from("orders")
    .select("id,order_number,status,total_amount,currency,external_order_id,external_system,external_status,external_status_label,created_at,delivery:payload->customer,note:payload->note,customers(display_name,username,phone),conversations(id,business_id,participant_avatar_path,participant_avatar_checked_at),order_items(id,quantity,unit_amount,options,position,products(name))")
    .eq("business_id", access.business.id).order("created_at", { ascending: false }).limit(1000) as unknown as { data: typeof orders; error: typeof error });
  if (error) throw new Error("Nuk u ngarkuan porositë.");
  // What each order took from or gave back to counted stock, shown with the order.
  const movements = await loadOrderStockMovements(access.business.id, (orders ?? []).map(o => o.id));
  // Whether the agent registers a confirmed order or only collects it for staff (server-owned policy).
  const policy = await createServiceSupabase().from("business_automation_policies").select("local_orders").eq("business_id", access.business.id).maybeSingle();
  const localOrders = policy.error ? null : policy.data?.local_orders === true;
  const { data: business } = await createServiceSupabase().from("businesses").select("product_fields").eq("id", access.business.id).maybeSingle();
  const productFields = readBusinessFields(business?.product_fields);

  return (
    <>
      <PageHeading
        eyebrow="Porosi"
        title={`Porositë e ${access.business.name}`}
        description="Ndiq porositë e krijuara nga bisedat me klientët."
      />
      {localOrders !== null && <p className="muted-copy mb-3">
        {localOrders ? "Agjenti e regjistron porosinë sapo klienti konfirmon përmbledhjen." : "Agjenti vetëm mbledh kërkesën: stafi e shqyrton te biseda dhe e regjistron."}{" "}
        <Link className="inline-link" href={`/b/${slug}/agents/process`}>Ndrysho te Çfarë bën Agjenti →</Link>
      </p>}
      <RecordBrowser
        listTitle="Të gjitha porositë"
        placeholder="Kërko numër porosie ose klient…"
        columns={["Porosia / Klienti", "Shuma", "Statusi", "Data"]}
        facets={[{ key: "status", label: "Statusi", options: ORDER_STATUSES.map(([value, label]) => ({ value, label })) }]}
        facetChips="status"
        sortable
        detailAsModal
        detailClassName="order-record-modal"
        initialOpenId={openOrder}
        emptyTitle="Ende nuk ka porosi"
        emptyDescription="Konfirmo një porosi nga biseda me klientin për ta parë këtu."
        records={(orders ?? []).map((o) => {
          const c = o.customers as unknown as {
            display_name: string | null;
            username: string | null;
            phone: string | null;
          } | null;
          const conversation = o.conversations as unknown as {
            id: string;
            business_id: string;
            participant_avatar_path: string | null;
            participant_avatar_checked_at: string | null;
          } | null;
          const avatarUrl = conversation?.business_id === access.business.id
            ? participantAvatarUrl(access.business.id, conversation.id, conversation.participant_avatar_path, conversation.participant_avatar_checked_at)
            : null;
          const items = orderLines(o.order_items as unknown as OrderItemRow[] | null, productFields);
          // What this order was saved and sent with; the customer card may have changed since.
          const delivery = orderDelivery({ customer: o.delivery });
          const sent = o.external_system === "external" && Boolean(o.external_order_id);
          const websiteStatus = typeof o.external_status === "string" && o.external_status
            ? { key: o.external_status, label: typeof o.external_status_label === "string" && o.external_status_label ? o.external_status_label : o.external_status }
            : null;
          // Why a failed order failed: the website's refusal, kept with the order.
          const submission = o.order_submissions as unknown as { rejection: { code?: string; field?: string; item?: number } | null } | { rejection: { code?: string; field?: string; item?: number } | null }[] | null;
          const refusal = o.status === "failed" ? refusalText((Array.isArray(submission) ? submission[0] : submission)?.rejection) : null;
          // One person, said once: the delivery repeats a name or phone only when it differs from the customer's.
          const customerName = c?.display_name || c?.username || delivery?.name || "";
          const same = (a?: string | null, b?: string | null) => (a ?? "").trim().toLocaleLowerCase() === (b ?? "").trim().toLocaleLowerCase();
          const digits = (v?: string | null) => (v ?? "").replace(/\D/g, "");
          const phone = c?.phone || delivery?.phone || null;
          const recipient = delivery?.name && !same(delivery.name, customerName) ? delivery.name : null;
          const otherPhone = delivery?.phone && c?.phone && digits(delivery.phone) !== digits(c.phone) ? delivery.phone : null;
          const chat = conversation?.business_id === access.business.id ? conversation.id : null;
          return {
            id: o.id,
            title: `#${o.order_number}`,
            subtitle: c?.display_name || c?.username || "Klient",
            leading: <ParticipantAvatar name={(c?.display_name || c?.username || "K").trim()} src={avatarUrl} size={40} />,
            facets: { status: o.status },
            cells: [
              money(o.total_amount, o.currency),
              websiteStatus ? <StatusBadge key="status" status={`website-${websiteStatus.key}`} label={websiteStatus.label} />
                : <span key="status" className="order-status-cell"><StatusBadge status={o.status} />{o.status === "failed" && <small>{refusal ?? "Shkaku nuk u ruajt"}</small>}</span>,
              formatDate(o.created_at),
            ],
            detail: (
              <div className="order-detail">
                <header className="order-detail-head">
                  <div className="order-detail-title">
                    <p className="order-detail-eyebrow">Porosia</p>
                    <h2>#{o.order_number}</h2>
                    <p className="order-detail-meta"><Icon name="calendar" size={14} /> {formatDate(o.created_at)}</p>
                    {chat && (
                      <div className="order-detail-actions">
                        <Link className="btn btn-ghost btn-small" href={`/b/${slug}/inbox/${chat}`}><Icon name="inbox" size={15} /> Hap bisedën</Link>
                      </div>
                    )}
                  </div>
                  <div className="order-detail-total">
                    <span>{o.external_system ? "Totali, pa transportin" : "Totali"}</span>
                    <strong>{money(o.total_amount, o.currency)}</strong>
                    <StatusBadge status={o.status} />
                  </div>
                </header>
                {o.status === "failed" && <p className="order-failure" role="note"><strong>Pse dështoi:</strong> {refusal ?? "Shkaku nuk u ruajt (porosi e vjetër). Kontrollo porosinë te webi i biznesit."}</p>}
                {o.status === "pending_reconciliation" && <p className="order-failure" role="note"><strong>Për verifikim:</strong> kontrollo në sistemin e jashtëm nëse porosia është pranuar. Mos e ridërgo: një timeout nuk provon dështim.</p>}
                {sent && (
                  <section className="order-web" aria-label="Statusi në webin e biznesit">
                    <span className="order-web-label"><Icon name="link" size={15} /> Webi i biznesit</span>
                    <WebsiteStatusControl businessId={access.business.id} orderId={o.id} initial={websiteStatus} />
                  </section>
                )}

                <div className="order-detail-grid">
                  <div className="order-detail-main">
                  <section className="order-card order-items-card">
                    <h3 className="order-card-title">{items.length > 1 ? `Artikujt (${items.length})` : "Artikulli"}</h3>
                    {items.length ? (
                      <ul className="order-items">
                        {items.map((item) => (
                          <li key={item.id} className="order-item">
                            <span className="order-item-qty">{item.quantity}×</span>
                            <div className="order-item-body">
                              <strong>{item.name}</strong>
                              {item.choices.length > 0 && (
                                <div className="order-item-choices">
                                  {item.choices.map((choice) => (
                                    <span key={choice.key} className="order-chip"><em>{choice.label}</em> {choice.value}</span>
                                  ))}
                                </div>
                              )}
                              {item.unit != null && item.quantity !== 1 && <small>{money(item.unit, o.currency)} / copë</small>}
                            </div>
                            <span className="order-item-total">{money(item.total, o.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="muted-copy">Kjo porosi nuk ka artikuj të ruajtur.</p>}
                    {typeof o.note === "string" && o.note ? (
                      <div className="order-note"><Icon name="file" size={14} /><p>{o.note}</p></div>
                    ) : null}
                    {items.length > 1 && (
                      <div className="order-items-sum">
                        <span>Totali i artikujve</span>
                        <strong>{money(o.total_amount, o.currency)}</strong>
                      </div>
                    )}
                    {(movements.get(o.id) ?? []).length > 0 && (
                      <div className="order-stock">
                        <h4>Stoku</h4>
                        <ul>
                          {(movements.get(o.id) ?? []).map((m) => (
                            <li key={m.id}>
                              <span>{stockReasonLabels[m.reason]}: {m.product_name ?? "Produkt i hequr"}</span>
                              <strong className={m.delta < 0 ? "is-out" : "is-in"}>{m.delta > 0 ? "+" : ""}{m.delta}</strong>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                  {/* The photos belong to the items: they sit under them, not across the page. */}
                  {o.external_system === "external" && o.external_order_id && <OrderOutputPhotos businessId={access.business.id} orderId={o.id} />}
                  </div>

                  <section className="order-card order-customer-card">
                    <h3 className="order-card-title">Klienti dhe dërgesa</h3>
                    <div className="order-person">
                      <ParticipantAvatar name={customerName.trim() || "K"} src={avatarUrl} size={42} className="order-avatar" />
                      <div>
                        <strong>{customerName || "Klient pa emër"}</strong>
                        {c?.username && <p><Icon name="instagram" size={13} /> @{c.username.replace(/^@/, "")}</p>}
                      </div>
                    </div>
                    {phone && <a className="order-contact" href={`tel:${phone.replace(/\s+/g, "")}`}><Icon name="phone" size={15} /> {phone}</a>}
                    {delivery ? (
                      <dl className="order-facts order-delivery-facts">
                        {recipient && <div className="order-delivery-wide"><dt>Marrësi</dt><dd>{recipient}</dd></div>}
                        {otherPhone && <div><dt>Telefoni i dërgesës</dt><dd>{otherPhone}</dd></div>}
                        <div><dt>Qyteti</dt><dd>{delivery.city || "—"}</dd></div>
                        <div className="order-delivery-wide"><dt>Adresa</dt><dd>{delivery.address || "—"}</dd></div>
                      </dl>
                    ) : (
                      <p className="muted-copy">Kjo porosi nuk ka të dhëna dërgese të ruajtura.</p>
                    )}
                    {o.status !== "pending_reconciliation" && <OrderEditor businessId={access.business.id} orderId={o.id} />}
                  </section>
                </div>

                <details className="order-tech">
                  <summary>Detaje teknike</summary>
                  <dl className="order-facts order-facts-inline">
                    <div><dt>Sistemi i jashtëm</dt><dd>{o.external_system || "—"}</dd></div>
                    <div><dt>Referenca e jashtme</dt><dd>{o.external_order_id || "—"}</dd></div>
                    <div><dt>ID në Agjenti</dt><dd>{o.id.slice(0, 8)}</dd></div>
                  </dl>
                  <p className="order-detail-foot">
                    Statusi pasqyron krijimin dhe përcjelljen e porosisë. Totali është shuma e artikujve; pagesat dhe transporti menaxhohen jashtë këtij paneli.
                  </p>
                </details>
              </div>
            ),
          };
        })}
      />
      {orders?.length === 1000 && (
        <p className="muted-copy">Po shfaqen 1 000 porositë më të fundit.</p>
      )}
    </>
  );
}
