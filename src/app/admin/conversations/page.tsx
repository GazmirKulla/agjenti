import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { decryptSecret } from "@/lib/crypto/tokens";
import {
  IntegrationsTable,
  type IntegrationRow,
} from "@/components/dashboard/integrations-table";
import { PageHeading } from "@/components/dashboard/ui";

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

  const rows: IntegrationRow[] = (connections ?? []).map((c) => {
    const b = c.businesses as unknown as { name: string; slug: string };
    let token: string | null = null;
    if (c.access_token_ciphertext) {
      try {
        token = decryptSecret(c.access_token_ciphertext);
      } catch {
        token = null;
      }
    }
    return {
      id: c.id,
      businessId: c.business_id,
      businessName: b.name,
      businessSlug: b.slug,
      username: c.username,
      status: c.status,
      lastError: c.last_error,
      refreshedAt: c.refreshed_at,
      token,
    };
  });

  return (
    <>
      <PageHeading
        title="Integrime"
        description="Gjendja e lidhjeve Instagram për bizneset e platformës."
      />
      <section className="panel section-pad">
        <h2 className="text-lg mb-4">Integrimet Instagram</h2>
        <IntegrationsTable rows={rows} />
      </section>
    </>
  );
}
