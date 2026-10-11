import Link from "next/link";
import { Icon } from "@/components/dashboard/icon";
import { WebsiteIntegration } from "@/components/dashboard/website-integration";
import { Suspense } from "react";
import InstagramAccountDetails from "@/components/instagram/account-details";
import WhatsAppAccountDetails from "@/components/whatsapp/account-details";
import { IntegrationDetailsDialog } from "@/components/dashboard/integration-details-dialog";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/dashboard/ui";
import { IntegrationCard } from "@/components/dashboard/integration-card";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { whatsappGraphVersion } from "@/lib/whatsapp/api";
import styles from "@/components/dashboard/integration-card.module.css";

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ detail?: string }> }) {
  const { slug } = await params;
  const { detail } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const [instagram, whatsapp, website] = await Promise.all([
    db.from("instagram_connections").select("username,ig_user_id,status,expires_at,last_error,updated_at")
      .eq("business_id", access.business.id).neq("status", "disconnected").maybeSingle(),
    db.from("whatsapp_connections").select("display_phone_number,verified_name,status,last_error,updated_at")
      .eq("business_id", access.business.id).maybeSingle(),
    db.from("integrations").select("catalog_url").eq("business_id", access.business.id).eq("kind", "http").maybeSingle(),
  ]);
  const ig = instagram.data;
  const wa = whatsapp.data;
  const igStatus = ig?.status === "connected" && ig.expires_at && Date.parse(ig.expires_at) <= Date.now() ? "expired" : ig?.status ?? "disconnected";
  const connectedCount = Number(!instagram.error && igStatus === "connected") + Number(!whatsapp.error && wa?.status === "connected");
  return <div className={styles.overview}>
    <PageHeading title="Integrimet" description="Lidh kanalet e komunikimit dhe webin e klientit.">
      {!instagram.error && !whatsapp.error && <span className={styles.count}>{connectedCount} nga 2 kanale të lidhura</span>}
    </PageHeading>
    <div className={styles.grid}>
      <IntegrationCard key={`instagram:${ig?.updated_at ?? "empty"}`} channel="instagram" businessId={access.business.id} slug={slug}
        status={igStatus} identity={ig?.username ? `@${ig.username}` : ig?.ig_user_id}
        loadError={Boolean(instagram.error)} needsAttention={Boolean(ig?.last_error)} />
      <IntegrationCard key={`whatsapp:${wa?.updated_at ?? "empty"}`} channel="whatsapp" businessId={access.business.id} slug={slug}
        status={wa?.status ?? "disconnected"} identity={wa?.display_phone_number || wa?.verified_name}
        loadError={Boolean(whatsapp.error)} needsAttention={Boolean(wa?.last_error)}
        whatsapp={{ appId: process.env.META_APP_ID ?? "", configId: process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ?? "", version: whatsappGraphVersion() }} />
      <article className={styles.row} aria-label="Webi i klientit">
        <div className={styles.heading}>
          <span className={`${styles.icon} ${styles.inactiveIcon}`}><Icon name="display" size={28} /></span>
          <div className={styles.title}>
            <h2>Webi i klientit</h2>
            <p className={styles.identity}>{website.error ? "Nuk u ngarkua konfigurimi i webit." : website.data?.catalog_url || "Lidh katalogun dhe porositë e webit përmes API-së"}</p>
            <p className={styles.status}>{website.error ? "Statusi nuk u ngarkua" : website.data?.catalog_url ? "E konfiguruar · testo lidhjen te detajet" : "E pakonfiguruar"}</p>
          </div>
        </div>
        <div className={styles.actions}><Link className="btn btn-ghost" href={`/b/${slug}/integrations?detail=website`} scroll={false}>Konfigurimi dhe specifikimet</Link></div>
      </article>
    </div>
    {detail === "website" && <IntegrationDetailsDialog slug={slug} name="Webi i klientit">
      <Suspense fallback={<p role="status">Duke ngarkuar konfigurimin…</p>}><WebsiteIntegration slug={slug} /></Suspense>
    </IntegrationDetailsDialog>}
    {(detail === "instagram" || detail === "whatsapp") && <IntegrationDetailsDialog slug={slug} name={detail === "instagram" ? "Instagram" : "WhatsApp"}>
      <Suspense fallback={<p role="status">Duke ngarkuar detajet…</p>}>
        {detail === "instagram" ? <InstagramAccountDetails params={params} searchParams={Promise.resolve({})} /> : <WhatsAppAccountDetails params={params} />}
      </Suspense>
    </IntegrationDetailsDialog>}
  </div>;
}
