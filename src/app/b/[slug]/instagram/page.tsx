import {
  PageHeading,
  StatusBadge,
  formatDate,
} from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function InstagramPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const supabase = createServiceSupabase();
  const { data: conn, error: loadError } = await supabase
    .from("instagram_connections")
    .select("username,ig_user_id,status,expires_at,last_error,refreshed_at")
    .eq("business_id", access.business.id)
    .neq("status", "disconnected")
    .maybeSingle();
  if (loadError) throw new Error("Nuk u ngarkua lidhja Instagram.");

  return (
    <>
      <PageHeading
        title="Instagram"
        description="Lidh llogarinë e biznesit për të menaxhuar bisedat me Agjentin AI."
      />
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
          <div className="flex items-center gap-4 my-6">
            <span className="profile-avatar">
              {access.business.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h3 className="text-xl">
                {conn
                  ? `@${conn.username || conn.ig_user_id}`
                  : "Asnjë llogari e lidhur"}
              </h3>
              <p className="muted-copy">{access.business.name}</p>
            </div>
          </div>
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
