import {
  PageHeading,
  StatusBadge,
  formatDate,
} from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
import { SecretReveal } from "@/components/dashboard/secret-reveal";
import { redirect } from "next/navigation";
import { decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { capturedInstagramProfile } from "@/lib/instagram/captured-profile";
import { InstagramAccountProfile } from "@/components/instagram/account-profile";

export default async function InstagramPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ disconnected?: string }>;
}) {
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
  if (loadError) throw new Error("Nuk u ngarkua lidhja Instagram.");

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

  return (
    <>
      <PageHeading
        title="Instagram"
        description="Lidh llogarinë e biznesit për të menaxhuar bisedat me Agjentin AI."
      />
      {query.disconnected === "1" && (
        <p className="mb-5 rounded-lg bg-danger-soft p-4 text-sm text-danger">
          Llogaria Instagram u shkëput.
        </p>
      )}
      <div className="panel section-pad mb-5 flex flex-wrap items-center gap-5">
        <span className="icon-tile tone-pink">
          <Icon name="instagram" size={29} />
        </span>
        <div className="flex-1">
          <h2 className="text-xl">Instagram Business</h2>
          <p className="muted-copy">Mesazhet e klientëve në një vend.</p>
        </div>
        <StatusBadge status={conn?.status || "disconnected"} />
      </div>
      <div className="configuration-layout">
        <section className="panel section-pad">
          <div className="section-title">
            <h2>Llogaria Instagram</h2>
            <StatusBadge status={conn?.status || "disconnected"} />
          </div>
          <InstagramAccountProfile profile={profile} username={conn ? conn.username || conn.ig_user_id : null} businessName={access.business.name} />
          {conn && (
            <div className="detail-block">
              <dl className="detail-fields">
                <div>
                  <dt>Statusi i lidhjes</dt>
                  <dd>
                    <StatusBadge status={conn.status} />
                  </dd>
                </div>
                <div>
                  <dt>Rifreskimi i fundit i token-it</dt>
                  <dd>{formatDate(conn.refreshed_at)}</dd>
                </div>
                <div>
                  <dt>Skadimi i token-it</dt>
                  <dd>{formatDate(conn.expires_at)}</dd>
                </div>
              </dl>
              {access.admin && accessToken && (
                <SecretReveal value={accessToken} label="Access token (vetëm admin)" />
              )}
              {access.admin && conn.access_token_ciphertext && !accessToken && (
                <p className="mt-4 text-sm text-danger">
                  Token-i nuk u deshifrua. Kontrollo TOKEN_ENCRYPTION_KEY.
                </p>
              )}
            </div>
          )}
          {conn?.last_error && (
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
              {conn ? "Rilidh llogarinë" : "Lidh Instagram"}
            </a>
            {conn && (
              <form
                action={`/api/businesses/${access.business.id}/instagram/disconnect`}
                method="post"
              >
                <button className="btn btn-ghost text-danger" type="submit">
                  Shkëput llogarinë
                </button>
              </form>
            )}
          </div>
          <p id="instagram-browser-help" className="muted-copy mt-3">
            Autorizimi hapet në Instagram web (Safari/Chrome), jo në app-in Instagram.
            Nëse je brenda Instagram-it ose Facebook-ut, hape Agjenti.app në Safari
            dhe lidhu aty. Pas lidhjes, rifresko këtë faqe për të parë statusin.
          </p>
        </section>
        <aside className="panel section-pad">
          <span className="icon-tile">
            <Icon name="inbox" size={25} />
          </span>
          <h2 className="text-lg mt-5">Nga Instagram në Inbox</h2>
          <p className="muted-copy">
            Pas lidhjes, mesazhet e reja të klientëve regjistrohen automatikisht
            në Inbox. Agjenti përgjigjet sipas konfigurimit të biznesit dhe
            statusit të bisedës.
          </p>
          <a className="soft-link" href={`/b/${slug}/inbox`}>
            Hap Inbox-in →
          </a>
        </aside>
      </div>
    </>
  );
}
