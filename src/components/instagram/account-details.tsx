import { LocalizedStatusBadge } from "@/components/dashboard/language";
import { getDashboardTranslator } from "@/lib/dashboard/language/server";
import {
  formatDate,
} from "@/components/dashboard/ui";
import { IntegrationAccountPanel } from "@/components/dashboard/integration-account-panel";
import { SecretReveal } from "@/components/dashboard/secret-reveal";
import { redirect } from "next/navigation";
import { decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { capturedInstagramProfile } from "@/lib/instagram/captured-profile";
import { isRejectedTokenError, TOKEN_REJECTED_NOTE } from "@/lib/channels/health";
import { InstagramAccountProfile } from "@/components/instagram/account-profile";

export default async function InstagramAccountDetails({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ disconnected?: string }>;
}) {
  const t = await getDashboardTranslator();
  const { slug } = await params;
  const query = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const supabase = createServiceSupabase();
  const { data: conn, error: loadError } = await supabase
    .from("instagram_connections")
    .select(
      "id,discovery_generation,username,ig_user_id,status,expires_at,last_error,refreshed_at,access_token_ciphertext",
    )
    .eq("business_id", access.business.id)
    .neq("status", "disconnected")
    .maybeSingle();
  if (loadError) throw new Error(t("Nuk u ngarkua lidhja Instagram."));

  const [discovery, captures] = conn ? await Promise.all([
    supabase.from("business_discovery").select("source_profile")
      .eq("business_id", access.business.id).maybeSingle(),
    supabase.from("business_discovery_jobs").select("source,input,profile:checkpoint->profile")
      .eq("business_id", access.business.id).eq("source", "instagram")
      .eq("input->>connectionId", conn.id).eq("input->>generation", conn.discovery_generation)
      .order("created_at", { ascending: false }).limit(24),
  ]) : [null, null];
  // Metadata is optional: connection management must still work before the
  // discovery tables are installed or when no analysis has been captured yet.
  const profile = capturedInstagramProfile(conn,
    (captures?.data ?? []).map(job => ({ ...job, checkpoint: { profile: job.profile } })),
    discovery?.data?.source_profile);

  let accessToken: string | null = null;
  if (access.admin && conn?.access_token_ciphertext) {
    try {
      accessToken = decryptSecret(conn.access_token_ciphertext);
    } catch {
      accessToken = null;
    }
  }

  // Connected, but Meta did not turn on the account's messages: nothing reaches the agent until it is fixed.
  const messagesOff = conn?.status === "connected" && /^(subscribed_apps|profile_incomplete):/.test(conn.last_error ?? "");
  const shownStatus = messagesOff ? "messages_off" : conn?.status || "disconnected";
  // Meta rejected the token: the agent cannot read or answer until the owner reconnects.
  const tokenRejected = conn?.status !== "connected" && isRejectedTokenError(conn?.last_error);
  return (
    <>
      {query.disconnected === "1" && (
        <p className="mb-5 rounded-lg bg-danger-soft p-4 text-sm text-danger">
          {t("Llogaria Instagram u shkëput.")}</p>
      )}
      <IntegrationAccountPanel name="Instagram" status={shownStatus}>
          <InstagramAccountProfile profile={profile} username={conn ? conn.username || conn.ig_user_id : null} businessName={access.business.name} />
          {conn && (
            <div className="detail-block">
              <dl className="detail-fields">
                <div>
                  <dt>{t("Statusi i lidhjes")}</dt>
                  <dd>
                    <LocalizedStatusBadge status={shownStatus} />
                  </dd>
                </div>
                <div>
                  <dt>{t("Rifreskimi i fundit i token-it")}</dt>
                  <dd>{formatDate(conn.refreshed_at, t("sq-AL"))}</dd>
                </div>
                <div>
                  <dt>{t("Skadimi i token-it")}</dt>
                  <dd>{formatDate(conn.expires_at, t("sq-AL"))}</dd>
                </div>
              </dl>
              {access.admin && accessToken && (
                <SecretReveal localized value={accessToken} label={t("Access token (vetëm admin)")} />
              )}
              {access.admin && conn.access_token_ciphertext && !accessToken && (
                <p className="mt-4 text-sm text-danger">
                  {t("Token-i nuk u deshifrua. Kontrollo TOKEN_ENCRYPTION_KEY.")}</p>
              )}
            </div>
          )}
          {tokenRejected ? (
            <div className="mt-5 rounded-lg bg-danger-soft p-4 text-sm text-danger grid gap-2">
              <strong>{t("Lidhja me Instagram-in nuk punon më.")}</strong>
              <span>{t(TOKEN_REJECTED_NOTE)}</span>
              <small>{t("Detaji teknik")}: {conn?.last_error}</small>
            </div>
          ) : messagesOff ? (
            <div className="mt-5 rounded-lg bg-danger-soft p-4 text-sm text-danger grid gap-2">
              <strong>{t("Mesazhet e Instagram-it nuk vijnë te Agjenti.")}</strong>
              <span>{t("Meta nuk e aktivizoi marrjen e mesazheve për këtë llogari. Zakonisht ndodh kur llogaria nuk është profesionale (Business ose Creator) ose kur gjatë lidhjes nuk u dhanë të gjitha lejet. Kontrollo llojin e llogarisë te Instagram → Cilësimet → Lloji i llogarisë, pastaj Rilidh llogarinë dhe prano të gjitha lejet.")}</span>
              <small>{t("Detaji teknik")}: {conn?.last_error}</small>
            </div>
          ) : conn?.last_error && (
            <p className="mt-5 rounded-lg bg-danger-soft p-4 text-sm text-danger">
              {conn.last_error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-5 mt-6">
            <a
              className="btn btn-primary"
              href={`/api/instagram/oauth/start?businessId=${access.business.id}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby="instagram-browser-help"
            >
              {tokenRejected ? t("Rilidh Instagram-in") : conn ? t("Rilidh llogarinë") : t("Lidh Instagram")}
            </a>
            {conn && (
              <form
                action={`/api/businesses/${access.business.id}/instagram/disconnect`}
                method="post"
              >
                <button className="btn btn-ghost text-danger" type="submit">
                  {t("Shkëput llogarinë")}</button>
              </form>
            )}
          </div>
          <p id="instagram-browser-help" className="muted-copy mt-3">
            {t("Autorizimi hapet në Instagram web (Safari/Chrome), jo në app-in Instagram. Nëse je brenda Instagram-it ose Facebook-ut, hape Agjenti.app në Safari dhe lidhu aty. Pas lidhjes, rifresko këtë faqe për të parë statusin.")}</p>
      </IntegrationAccountPanel>
    </>
  );
}
