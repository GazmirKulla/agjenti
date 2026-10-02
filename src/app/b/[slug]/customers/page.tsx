import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, formatDate } from "@/components/dashboard/ui";
export default async function CustomersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const { data: customers, error } = await createServiceSupabase()
    .from("customers")
    .select("id,display_name,username,phone,created_at")
    .eq("business_id", access.business.id)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error("Nuk u ngarkuan klientët.");
  return (
    <>
      <PageHeading
        eyebrow="Klientët e mi"
        title={access.business.name}
        description="Informacionet e kontaktit të klientëve nga bisedat e biznesit."
      />
      <RecordBrowser
        listTitle="Lista e klientëve"
        placeholder="Kërko emër ose Instagram…"
        columns={["Klienti", "Telefoni", "Klient që nga"]}
        emptyTitle="Ende nuk ka klientë"
        emptyDescription="Klientët regjistrohen kur dërgojnë mesazhin e parë në Instagram."
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
      {customers?.length === 1000 && (
        <p className="muted-copy">Po shfaqen 1 000 klientët më të fundit.</p>
      )}
    </>
  );
}
