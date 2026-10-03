import { PAGE_SIZE, parseListParams } from "@/lib/dashboard/pagination";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, formatDate } from "@/components/dashboard/ui";
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
  const paging = parseListParams(await searchParams);
  let query = createServiceSupabase()
    .from("customers")
    .select("id,display_name,username,phone,created_at", { count: "exact" })
    .eq("business_id", access.business.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (paging.filter)
    query = query.or(
      `display_name.ilike.%${paging.filter}%,username.ilike.%${paging.filter}%`,
    );
  const {
    data: customers,
    error,
    count,
  } = await query.range(paging.from, paging.to);
  if (error) throw new Error("Nuk u ngarkuan klientët.");
  return (
    <>
      <PageHeading
        eyebrow="Klientët e mi"
        title={access.business.name}
        description="Klientët CRM krijohen kur konfirmohet një porosi ose kur menaxheri i shton nga Inbox."
      />
      <RecordBrowser
        key={`${paging.page}:${paging.search}`}
        serverPage={{
          page: paging.page,
          pageSize: PAGE_SIZE,
          total: count ?? 0,
          search: paging.search,
          path: `/b/${slug}/customers`,
        }}
        listTitle="Lista e klientëve"
        placeholder="Kërko emër ose Instagram…"
        columns={["Klienti", "Telefoni", "Klient që nga"]}
        emptyTitle="Ende nuk ka klientë"
        emptyDescription="Një bisedë Instagram nuk krijon klient automatikisht. Shtoje nga Inbox ose konfirmo porosinë pasi workflow-i të jetë plotësuar."
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
            </>
          ),
        }))}
      />
    </>
  );
}
