import { PAGE_SIZE, parseListParams } from "@/lib/dashboard/pagination";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, formatDate } from "@/components/dashboard/ui";
import { CustomerActions } from "@/components/dashboard/customer-actions";
export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const params2 = await searchParams;
  const paging = parseListParams(params2);
  // "Hiq nga lista" archives a customer; archived customers have their own view.
  const archivedView = params2.view === "archived";
  const db = createServiceSupabase();
  const list = (withArchive: boolean) => {
    let query = db
      .from("customers")
      .select("id,display_name,username,phone,created_at", { count: "exact" })
      .eq("business_id", access.business.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (withArchive) query = archivedView ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    if (paging.filter)
      query = query.or(
        `display_name.ilike.%${paging.filter}%,username.ilike.%${paging.filter}%`,
      );
    return query.range(paging.from, paging.to);
  };
  let result = await list(true);
  // Before the archive migration, list every customer as active.
  const archiveReady = !(result.error && result.error.code === "42703");
  if (!archiveReady) result = archivedView ? { data: [], error: null, count: 0 } as unknown as typeof result : await list(false);
  const { data: customers, error, count } = result;
  if (error) throw new Error("Nuk u ngarkuan klientët.");
  const [{ count: archivedCount }, membership, orderRows] = await Promise.all([
    archiveReady
      ? db.from("customers").select("id", { count: "exact", head: true }).eq("business_id", access.business.id).not("archived_at", "is", null)
      : Promise.resolve({ count: 0 }),
    db.from("business_users").select("role").eq("business_id", access.business.id).eq("user_id", user.id).maybeSingle(),
    (customers ?? []).length
      ? db.from("orders").select("customer_id").eq("business_id", access.business.id).in("customer_id", (customers ?? []).map((c) => c.id))
      : Promise.resolve({ data: [] as { customer_id: string }[] }),
  ]);
  // Only the owner (or a platform administrator) may remove or delete customers.
  const canManage = archiveReady && (access.admin || membership.data?.role === "owner");
  const ordersByCustomer = new Map<string, number>();
  for (const row of orderRows.data ?? []) ordersByCustomer.set(row.customer_id, (ordersByCustomer.get(row.customer_id) ?? 0) + 1);
  return (
    <>
      <PageHeading
        eyebrow="Klientët e mi"
        title={access.business.name}
        description="Klientët CRM krijohen kur konfirmohet një porosi ose kur menaxheri i shton nga Inbox."
      />
      {archiveReady && <nav className="customer-views" aria-label="Pamjet e klientëve">
        <Link href={`/b/${slug}/customers`} aria-current={archivedView ? undefined : "page"}>Aktivë</Link>
        <Link href={`/b/${slug}/customers?view=archived`} aria-current={archivedView ? "page" : undefined}>
          Të arkivuar{archivedCount ? ` (${archivedCount})` : ""}
        </Link>
      </nav>}
      <RecordBrowser
        key={`${archivedView ? "archived" : "active"}:${paging.page}:${paging.search}`}
        serverPage={{
          page: paging.page,
          pageSize: PAGE_SIZE,
          total: count ?? 0,
          search: paging.search,
          path: `/b/${slug}/customers`,
          ...(archivedView ? { filters: { view: "archived" } } : {}),
        }}
        listTitle={archivedView ? "Klientët e arkivuar" : "Lista e klientëve"}
        placeholder="Kërko emër ose Instagram…"
        columns={["Klienti", "Telefoni", "Klient që nga"]}
        emptyTitle={archivedView ? "Nuk ka klientë të arkivuar" : "Ende nuk ka klientë"}
        emptyDescription={archivedView
          ? "Klientët që heq nga lista shfaqen këtu. Mund t’i rikthesh ose t’i fshish përgjithmonë."
          : "Një bisedë Instagram nuk krijon klient automatikisht. Shtoje nga Inbox ose konfirmo porosinë pasi workflow-i të jetë plotësuar."}
        records={(customers ?? []).map((c) => ({
          id: c.id,
          title: c.display_name || c.username || "Klient Instagram",
          subtitle: c.username ? `@${c.username}` : undefined,
          cells: [c.phone || "—", formatDate(c.created_at)],
          detail: (
            <>
              <div className="detail-header">
                <div>
                  <h2>{c.display_name || c.username || "Klient Instagram"}</h2>
                  <p>{c.username ? `@${c.username}` : "Instagram"}</p>
                </div>
                <span className="profile-avatar">
                  {(c.display_name || c.username || "K")
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              </div>
              <div className="detail-block">
                <h3>Informacioni i kontaktit</h3>
                <dl className="detail-fields">
                  <div>
                    <dt>Instagram</dt>
                    <dd>{c.username || "—"}</dd>
                  </div>
                  <div>
                    <dt>Telefoni</dt>
                    <dd>{c.phone || "Nuk është dhënë"}</dd>
                  </div>
                  <div>
                    <dt>Klient që nga</dt>
                    <dd>{formatDate(c.created_at)}</dd>
                  </div>
                </dl>
              </div>
              <Link href={`/b/${slug}/inbox`} className="soft-link">
                Hap Inbox-in
              </Link>
              {canManage && (
                <CustomerActions
                  slug={slug}
                  customerId={c.id}
                  name={c.display_name || c.username || "Klient Instagram"}
                  archived={archivedView}
                  orders={ordersByCustomer.get(c.id) ?? 0}
                />
              )}
            </>
          ),
        }))}
      />
    </>
  );
}
