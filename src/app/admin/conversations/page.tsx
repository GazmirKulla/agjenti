import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import { SecretReveal } from "@/components/dashboard/secret-reveal";
import {
  PageHeading,
  StatusBadge,
  formatDate,
} from "@/components/dashboard/ui";

export default async function AdminIntegrations() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const db = createServiceSupabase();
  const { data: connections, error } = await db
    .from("instagram_connections")
    .select(
      "id,business_id,username,status,last_error,refreshed_at,access_token_ciphertext,businesses(name,slug)",
    )
    .neq("status", "disconnected")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error("Nuk u ngarkuan integrimet.");
  return (
    <>
      <PageHeading
        title="Integrime"
        description="Gjendja e lidhjeve Instagram për bizneset e platformës."
      />
      <section className="panel section-pad">
        <h2 className="text-lg mb-4">Integrimet Instagram</h2>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Biznesi</th>
                <th>Llogaria</th>
                <th>Statusi</th>
                <th>Access token</th>
                <th>Rifreskimi i token-it</th>
                <th>Veprimi</th>
              </tr>
            </thead>
            <tbody>
              {connections?.map((c) => {
                const b = c.businesses as unknown as {
                  name: string;
                  slug: string;
                };
                let token: string | null = null;
                if (c.access_token_ciphertext) {
                  try {
                    token = decryptSecret(c.access_token_ciphertext);
                  } catch {
                    token = null;
                  }
                }
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
                    <td className="token-cell">
                      {token ? (
                        <SecretReveal value={token} label="Access token" />
                      ) : (
                        <span className="muted-copy">I padisponueshëm</span>
                      )}
                    </td>
                    <td>{formatDate(c.refreshed_at)}</td>
                    <td>
                      <div className="flex flex-col gap-3 items-start">
                        <Link
                          className="text-accent"
                          href={`/b/${b.slug}/instagram`}
                        >
                          Menaxho →
                        </Link>
                        <form
                          action={`/api/businesses/${c.business_id}/instagram/disconnect`}
                          method="post"
                        >
                          <button
                            className="btn btn-ghost text-danger"
                            type="submit"
                          >
                            Shkëput llogarinë
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!connections?.length && (
            <p className="muted-copy py-6">
              Ende nuk ka llogari Instagram të lidhura.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
