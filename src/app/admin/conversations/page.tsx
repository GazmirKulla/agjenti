import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import {
  PageHeading,
  StatusBadge,
  formatDate,
} from "@/components/dashboard/ui";
export default async function AdminConversations() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/app");
  const db = createServiceSupabase();
  const [conversations, connections] = await Promise.all([
    db
      .from("conversations")
      .select(
        "id,status,last_message_preview,last_message_at,customers(display_name,username),businesses(name,slug)",
      )
      .order("last_message_at", { ascending: false })
      .limit(1000),
    db
      .from("instagram_connections")
      .select(
        "id,username,status,last_error,refreshed_at,businesses(name,slug)",
      )
      .neq("status", "disconnected")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (conversations.error || connections.error)
    throw new Error("Nuk u ngarkuan bisedat dhe integrimet.");
  return (
    <>
      <PageHeading
        title="Biseda & Integrime"
        description="Ndiq bisedat e bizneseve dhe gjendjen e lidhjeve me Instagram."
      />
      <RecordBrowser
        listTitle="Bisedat e fundit"
        placeholder="Kërko klient ose biznes…"
        columns={["Klienti / Biznesi", "Statusi", "Aktiviteti"]}
        records={(conversations.data ?? []).map((c) => {
          const customer = c.customers as unknown as {
            display_name: string | null;
            username: string | null;
          } | null;
          const b = c.businesses as unknown as { name: string; slug: string };
          return {
            id: c.id,
            title:
              customer?.display_name ||
              customer?.username ||
              "Klient Instagram",
            subtitle: b.name,
            cells: [
              <StatusBadge key="status" status={c.status} />,
              formatDate(c.last_message_at),
            ],
            detail: (
              <>
                <div className="detail-header">
                  <div>
                    <h2>
                      {customer?.display_name ||
                        customer?.username ||
                        "Klient Instagram"}
                    </h2>
                    <p>{b.name}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="detail-block">
                  <h3>Mesazhi i fundit</h3>
                  <p className="muted-copy whitespace-pre-wrap">
                    {c.last_message_preview || "Pa mesazh"}
                  </p>
                </div>
                <Link className="soft-link" href={`/b/${b.slug}/inbox/${c.id}`}>
                  Hap bisedën →
                </Link>
              </>
            ),
          };
        })}
      />
      {conversations.data?.length === 1000 && (
        <p className="muted-copy">Po shfaqen 1 000 bisedat më të fundit.</p>
      )}
      <section className="panel section-pad mt-6">
        <h2 className="text-lg mb-4">Integrimet Instagram</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Biznesi</th>
                <th>Llogaria</th>
                <th>Statusi</th>
                <th>Rifreskimi i token-it</th>
                <th>Veprimi</th>
              </tr>
            </thead>
            <tbody>
              {connections.data?.map((c) => {
                const b = c.businesses as unknown as {
                  name: string;
                  slug: string;
                };
                return (
                  <tr key={c.id}>
                    <td>{b.name}</td>
                    <td>{c.username ? `@${c.username}` : "—"}</td>
                    <td>
                      <StatusBadge status={c.status} />
                      {c.last_error && (
                        <p className="text-danger mt-2">{c.last_error}</p>
                      )}
                    </td>
                    <td>{formatDate(c.refreshed_at)}</td>
                    <td>
                      <Link
                        className="text-accent"
                        href={`/b/${b.slug}/instagram`}
                      >
                        Menaxho →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!connections.data?.length && (
            <p className="muted-copy py-6">
              Ende nuk ka llogari Instagram të lidhura.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
