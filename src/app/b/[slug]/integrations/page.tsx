import { getDashboardTranslator } from "@/lib/dashboard/language/server";
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
import { channelHealth, effectiveStatus, timeAgo } from "@/lib/channels/health";
import { loadChannelActivity } from "@/lib/channels/service";
import { loadReadiness } from "@/lib/setup/readiness";
import { AutoReplyPanel } from "@/components/dashboard/auto-reply-panel";

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ detail?: string }> }) {
  const t = await getDashboardTranslator();
  const { slug } = await params;
  const { detail } = await searchParams;
  // The business website moved to Produktet; old links still open it there.
  if (detail === "website") redirect(`/b/${slug}/products?detail=website`);
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const [instagram, whatsapp] = await Promise.all([
    db.from("instagram_connections").select("username,ig_user_id,status,expires_at,last_error,updated_at")
      .eq("business_id", access.business.id).neq("status", "disconnected").maybeSingle(),
    db.from("whatsapp_connections").select("display_phone_number,verified_name,status,last_error,updated_at")
      .eq("business_id", access.business.id).maybeSingle(),
  ]);
  const ig = instagram.data;
  const wa = whatsapp.data;
  const igConnection = ig ? { status: ig.status, expiresAt: ig.expires_at, lastError: ig.last_error } : null;
  const waConnection = wa ? { status: wa.status, lastError: wa.last_error } : null;
  const igStatus = effectiveStatus(igConnection);
  const [igActivity, waActivity] = await Promise.all([
    igStatus === "connected" ? loadChannelActivity(access.business.id, "instagram") : null,
    wa?.status === "connected" ? loadChannelActivity(access.business.id, "whatsapp") : null,
  ]);
  const worded = (a: Awaited<ReturnType<typeof loadChannelActivity>>) => a && { lastInbound: timeAgo(a.lastInboundAt), weekInbound: a.weekInbound };
  const readiness = await loadReadiness(access.business);
  const connectedCount = Number(!instagram.error && igStatus === "connected") + Number(!whatsapp.error && wa?.status === "connected");
  return <div className={styles.overview}>
    <PageHeading title={t("Kanalet")} description={t("Kanalet ku klientët të shkruajnë dhe ku u përgjigjet agjenti. Shiko nëse secili po merr mesazhe.")}>
      {!instagram.error && !whatsapp.error && <span className={styles.count}>{connectedCount} {t("nga 2 kanale të lidhura")}</span>}
    </PageHeading>
    {readiness && <AutoReplyPanel slug={access.business.slug} readiness={readiness} />}
    <div className={styles.grid}>
      <IntegrationCard key={`instagram:${ig?.updated_at ?? "empty"}`} channel="instagram" businessId={access.business.id} slug={slug}
        status={igStatus} identity={ig?.username ? `@${ig.username}` : ig?.ig_user_id}
        loadError={Boolean(instagram.error)} needsAttention={Boolean(ig?.last_error)}
        activity={worded(igActivity)} health={channelHealth("instagram", igConnection, igActivity)} />
      <IntegrationCard key={`whatsapp:${wa?.updated_at ?? "empty"}`} channel="whatsapp" businessId={access.business.id} slug={slug}
        status={wa?.status ?? "disconnected"} identity={wa?.display_phone_number || wa?.verified_name}
        loadError={Boolean(whatsapp.error)} needsAttention={Boolean(wa?.last_error)}
        activity={worded(waActivity)} health={channelHealth("whatsapp", waConnection, waActivity)}
        whatsapp={{ appId: process.env.META_APP_ID ?? "", configId: process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ?? "", version: whatsappGraphVersion() }} />
    </div>
    {(detail === "instagram" || detail === "whatsapp") && <IntegrationDetailsDialog slug={slug} name={detail === "instagram" ? "Instagram" : "WhatsApp"}>
      <Suspense fallback={<p role="status">{t("Duke ngarkuar detajet…")}</p>}>
        {detail === "instagram" ? <InstagramAccountDetails params={params} searchParams={Promise.resolve({})} /> : <WhatsAppAccountDetails params={params} />}
      </Suspense>
    </IntegrationDetailsDialog>}
  </div>;
}
