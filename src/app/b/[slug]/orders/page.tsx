import { RecordBrowser } from "@/components/dashboard/record-browser";
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

export default async function OrdersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const { data: orders, error } = await createServiceSupabase()
    .from("orders")
    .select(
      "id,status,total_amount,currency,external_order_id,external_system,created_at,customers(display_name,username,phone)",
    )
    .eq("business_id", access.business.id)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error("Nuk u ngarkuan porositë.");

  return (
    <>
      <PageHeading
        eyebrow="Porosi"
        title={`Porositë e ${access.business.name}`}
        description="Ndiq porositë e krijuara nga bisedat me klientët."
      />
      <div className="stats-grid">
        {[
          ["draft", "Draft"],
          ["confirmed", "Të konfirmuara"],
          ["submitted", "Të përcjella"],
          ["failed", "Të dështuara"],
        ].map(([status, label]) => (
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
        emptyTitle="Ende nuk ka porosi"
        emptyDescription="Konfirmo një porosi nga biseda me klientin për ta parë këtu."
        records={(orders ?? []).map((o) => {
          const c = o.customers as unknown as {
            display_name: string | null;
            username: string | null;
            phone: string | null;
          } | null;
          return {
            id: o.id,
            title: `#${o.external_order_id || o.id.slice(0, 8)}`,
            subtitle: c?.display_name || c?.username || "Klient",
            cells: [
              money(o.total_amount, o.currency),
              <StatusBadge key="status" status={o.status} />,
              formatDate(o.created_at),
            ],
            detail: (
              <>
                <div className="detail-header">
                  <div>
                    <h2>#{o.external_order_id || o.id.slice(0, 8)}</h2>
                    <p>{formatDate(o.created_at)}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="detail-block">
                  <h3>Informacioni i klientit</h3>
                  <dl className="detail-fields">
                    <div>
                      <dt>Emri</dt>
                      <dd>{c?.display_name || "—"}</dd>
                    </div>
                    <div>
                      <dt>Instagram</dt>
                      <dd>{c?.username || "—"}</dd>
                    </div>
                    <div>
                      <dt>Telefoni</dt>
                      <dd>{c?.phone || "—"}</dd>
                    </div>
                  </dl>
                </div>
                <div className="detail-block">
                  <h3>Informacioni i porosisë</h3>
                  <dl className="detail-fields">
                    <div>
                      <dt>Totali</dt>
                      <dd>{money(o.total_amount, o.currency)}</dd>
                    </div>
                    <div>
                      <dt>Sistemi i jashtëm</dt>
                      <dd>{o.external_system || "—"}</dd>
                    </div>
                    <div>
                      <dt>Referenca e jashtme</dt>
                      <dd>{o.external_order_id || "—"}</dd>
                    </div>
                  </dl>
                </div>
                <p className="muted-copy">
                  Statusi pasqyron krijimin dhe përcjelljen e porosisë. Pagesat
                  dhe transporti menaxhohen jashtë këtij paneli.
                </p>
              </>
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
