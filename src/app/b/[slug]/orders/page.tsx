import { orderDelivery } from "@/lib/customers/contact";
import { OrderEditor } from "@/components/dashboard/order-editor";
import { WebsiteStatusControl } from "@/components/dashboard/website-status-control";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { OrderOutputPhotos } from "@/components/dashboard/order-output-photos";
import { Icon } from "@/components/dashboard/icon";
import {
  PageHeading,
  StatCard,
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

/** Every item of the order in the order it was written, with its readable choices. */
function orderLines(rows: OrderItemRow[] | null) {
  return [...(rows ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row) => {
      const quantity = Number(row.quantity);
      const unit = row.unit_amount == null ? null : Number(row.unit_amount);
      const choices = Object.entries(row.options ?? {})
        .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) && String(value).trim())
        .map(([key, value]) => ({ key, value: value === true ? "po" : String(value) }));
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
  const { data: orders, error } = await createServiceSupabase()
    .from("orders")
    .select(
      "id,status,total_amount,currency,external_order_id,external_system,external_status,external_status_label,created_at,delivery:payload->customer,note:payload->note,customers(display_name,username,phone),order_items(id,quantity,unit_amount,options,position,products(name))",
    )
    .eq("business_id", access.business.id)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error("Nuk u ngarkuan porositë.");
  // What each order took from or gave back to counted stock, shown with the order.
  const movements = await loadOrderStockMovements(access.business.id, (orders ?? []).map(o => o.id));

  return (
    <>
      <PageHeading
        eyebrow="Porosi"
        title={`Porositë e ${access.business.name}`}
        description="Ndiq porositë e krijuara nga bisedat me klientët."
      />
      <div className="stats-grid stats-compact">
        {ORDER_STATUSES.map(([status, label]) => (
          <StatCard
            key={status}
            label={label}
            value={(orders ?? []).filter((o) => o.status === status).length}
            hint="Në listën e ngarkuar"
            icon="orders"
          />
        ))}
      </div>
      <RecordBrowser
        listTitle="Të gjitha porositë"
        placeholder="Kërko numër porosie ose klient…"
        columns={["Porosia / Klienti", "Shuma", "Statusi", "Data"]}
        facets={[{ key: "status", label: "Statusi", options: ORDER_STATUSES.map(([value, label]) => ({ value, label })) }]}
        sortable
        detailAsModal
        initialOpenId={openOrder}
        emptyTitle="Ende nuk ka porosi"
        emptyDescription="Konfirmo një porosi nga biseda me klientin për ta parë këtu."
        records={(orders ?? []).map((o) => {
          const c = o.customers as unknown as {
            display_name: string | null;
            username: string | null;
            phone: string | null;
          } | null;
          const items = orderLines(o.order_items as unknown as OrderItemRow[] | null);
          // What this order was saved and sent with; the customer card may have changed since.
          const delivery = orderDelivery({ customer: o.delivery });
          const sent = o.external_system === "external" && Boolean(o.external_order_id);
          const websiteStatus = typeof o.external_status === "string" && o.external_status
            ? { key: o.external_status, label: typeof o.external_status_label === "string" && o.external_status_label ? o.external_status_label : o.external_status }
            : null;
          return {
            id: o.id,
            title: `#${o.external_order_id || o.id.slice(0, 8)}`,
            subtitle: c?.display_name || c?.username || "Klient",
            facets: { status: o.status },
            cells: [
              money(o.total_amount, o.currency),
              websiteStatus ? <StatusBadge key="status" status={`website-${websiteStatus.key}`} label={websiteStatus.label} /> : <StatusBadge key="status" status={o.status} />,
              formatDate(o.created_at),
            ],
            detail: (
              <div className="order-detail">
                <header className="order-detail-head">
                  <span className="order-detail-icon"><Icon name="orders" size={22} /></span>
                  <div className="order-detail-title">
                    <p className="order-detail-eyebrow">Porosia</p>
                    <h2>#{o.external_order_id || o.id.slice(0, 8)}</h2>
                    <p className="order-detail-meta">
                      <Icon name="calendar" size={14} /> {formatDate(o.created_at)}
                      {c?.display_name || c?.username ? <> · <Icon name="customers" size={14} /> {c?.display_name || c?.username}</> : null}
                    </p>
                  </div>
                  <div className="order-detail-total">
                    <span>Totali</span>
                    <strong>{money(o.total_amount, o.currency)}</strong>
                    <div className="order-detail-badges">
                      <StatusBadge status={o.status} />
                      {websiteStatus && <StatusBadge status={`website-${websiteStatus.key}`} label={`Webi: ${websiteStatus.label}`} />}
                    </div>
                  </div>
                </header>

                <div className="order-detail-grid">
                  <section className="order-card">
                    <h3 className="order-card-title"><span className="order-card-icon"><Icon name="products" size={16} /></span>
                      {items.length > 1 ? `Artikujt (${items.length})` : "Artikulli"}</h3>
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
                                    <span key={choice.key} className="order-chip"><em>{choice.key}</em> {choice.value}</span>
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
                    <div className="order-items-sum">
                      <span>Totali i artikujve</span>
                      <strong>{money(o.total_amount, o.currency)}</strong>
                    </div>
                    {o.external_system && <p className="order-card-note">Pa transportin: webi i biznesit e shton te totali i vet.</p>}
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

                  <div className="order-detail-side">
                    <section className="order-card">
                      <h3 className="order-card-title"><span className="order-card-icon"><Icon name="customers" size={16} /></span>Klienti</h3>
                      <div className="order-person">
                        <span className="order-avatar">{(c?.display_name || c?.username || "K").trim().slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{c?.display_name || "Klient pa emër"}</strong>
                          {c?.username && <p><Icon name="instagram" size={13} /> @{c.username.replace(/^@/, "")}</p>}
                        </div>
                      </div>
                      {c?.phone && <a className="order-contact" href={`tel:${c.phone.replace(/\s+/g, "")}`}><Icon name="phone" size={15} /> {c.phone}</a>}
                    </section>

                    <section className="order-card">
                      <h3 className="order-card-title"><span className="order-card-icon"><Icon name="car" size={16} /></span>Dërgesa</h3>
                      {delivery ? (
                        <dl className="order-facts">
                          <div><dt><Icon name="customers" size={14} /> Marrësi</dt><dd>{delivery.name || "—"}</dd></div>
                          <div><dt><Icon name="phone" size={14} /> Telefoni</dt><dd>{delivery.phone || "—"}</dd></div>
                          <div><dt><Icon name="store" size={14} /> Qyteti</dt><dd>{delivery.city || "—"}</dd></div>
                          <div><dt><Icon name="home" size={14} /> Adresa</dt><dd>{delivery.address || "—"}</dd></div>
                        </dl>
                      ) : (
                        <p className="muted-copy">Kjo porosi nuk ka të dhëna dërgese të ruajtura.</p>
                      )}
                      {typeof o.note === "string" && o.note ? (
                        <div className="order-note"><Icon name="file" size={14} /><p>{o.note}</p></div>
                      ) : null}
                      {o.status !== "pending_reconciliation" && <OrderEditor businessId={access.business.id} orderId={o.id} />}
                    </section>
                  </div>
                </div>

                {o.external_system === "external" && o.external_order_id && <OrderOutputPhotos businessId={access.business.id} orderId={o.id} />}
                {sent && (
                  <section className="order-card">
                    <h3 className="order-card-title"><span className="order-card-icon"><Icon name="link" size={16} /></span>Statusi në webin e biznesit</h3>
                    <WebsiteStatusControl businessId={access.business.id} orderId={o.id} initial={websiteStatus} />
                  </section>
                )}

                <section className="order-card order-card-quiet">
                  <h3 className="order-card-title"><span className="order-card-icon"><Icon name="history" size={16} /></span>Informacioni i porosisë</h3>
                  <dl className="order-facts order-facts-inline">
                    <div><dt>Sistemi i jashtëm</dt><dd>{o.external_system || "—"}</dd></div>
                    <div><dt>Referenca e jashtme</dt><dd>{o.external_order_id || "—"}</dd></div>
                    <div><dt>ID në Agjenti</dt><dd>{o.id.slice(0, 8)}</dd></div>
                  </dl>
                </section>
                <p className="order-detail-foot">
                  Statusi pasqyron krijimin dhe përcjelljen e porosisë. Totali
                  është shuma e artikujve; pagesat dhe transporti menaxhohen
                  jashtë këtij paneli.
                  {o.status === "pending_reconciliation" && " Kontrollo në sistemin e jashtëm nëse porosia është pranuar. Mos e ridërgo: një timeout nuk provon dështim."}
                </p>
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
