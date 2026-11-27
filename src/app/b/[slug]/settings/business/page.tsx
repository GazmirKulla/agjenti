import { setupGateMessage } from "@/lib/setup/model";
import { loadSetupStatus } from "@/lib/setup/status";
import { setBusinessAutoReply } from "@/lib/agents/auto-reply";
import { ActionForm } from "@/components/dashboard/action-form";
import { loadItemSetup } from "@/lib/items/business";
import Link from "next/link";
import { Icon } from "@/components/dashboard/icon";
import { PageHeading } from "@/components/dashboard/ui";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadBusinessLogo } from "@/lib/businesses/logo";
import { BusinessLogoSettings } from "@/components/settings/business-logo";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: requestedSlug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, requestedSlug);
  if (!access) redirect("/auth/continue");
  const slug = access.business.slug;

  async function saveBusiness(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    try { await setBusinessAutoReply(acc.business.id, formData.get("auto_reply") === "on", acc.business.auto_reply); }
    catch (error) { return { error: (error as Error).message }; }
    revalidatePath(`/b/${slug}`, "layout");
    return { success: "Cilësimet e biznesit u ruajtën." };
  }

  const { data: integration, error: integrationError } =
    await createServiceSupabase()
      .from("integrations")
      .select("catalog_url")
      .eq("business_id", access.business.id)
      .eq("kind", "http")
      .maybeSingle();
  if (integrationError) throw new Error("Nuk u ngarkua integrimi i biznesit.");

  const linked = Boolean(integration?.catalog_url?.trim());
  const db = createServiceSupabase();
  const [logo, { data: instagram }] = await Promise.all([
    loadBusinessLogo(db, access.business.id),
    db.from("instagram_connections").select("id").eq("business_id", access.business.id).eq("status", "connected").maybeSingle(),
  ]);
  const items = await loadItemSetup(access.business.id);
  const autoReplyBlocked = access.business.auto_reply
    ? null
    : setupGateMessage(await loadSetupStatus(access.business.id));
  return (
    <>
      <PageHeading
        eyebrow="Cilësimet"
        title={access.business.name}
        description="Të dhënat e biznesit dhe përgjigjet automatike për klientët."
      />
      <div className="grid gap-6">
            {/* What the agent tells customers is edited in the Agjenti topics, in one place each. */}
            <section className="panel section-pad settings-agent-links" aria-labelledby="settings-agent-links-title">
              <h2 id="settings-agent-links-title" className="settings-heading"><span className="profile-group-icon" aria-hidden="true"><Icon name="agents" size={20} /></span>Çfarë u thotë Agjenti klientëve</h2>
              <p className="muted-copy">Këto ndryshohen te Agjenti; Agjenti i lexon direkt nga aty.</p>
              <Link className="settings-agent-link" href={`/b/${slug}/agents/business`}>
                <Icon name="briefcase" size={18} />
                <span><b>Profili publik</b><small>Përshkrimi, kontaktet, adresa dhe orari</small></span>
                <span aria-hidden="true">→</span>
              </Link>
              <Link className="settings-agent-link" href={`/b/${slug}/knowledge`}>
                <Icon name="knowledge" size={18} />
                <span><b>Oferta</b><small>Produktet, shërbimet dhe pyetjet e shpeshta</small></span>
                <span aria-hidden="true">→</span>
              </Link>
            </section>
            <BusinessLogoSettings slug={slug} name={access.business.name} logoUrl={logo?.url ?? null} source={logo?.source ?? null}
              instagramConnected={Boolean(instagram)} available={Boolean(logo)} />
            <ActionForm
              action={saveBusiness}
              className="panel section-pad grid gap-5"
            >
              <div className="section-title">
                <h2 className="settings-heading"><span className="profile-group-icon" aria-hidden="true"><Icon name="store" size={20} /></span>Të dhënat e biznesit</h2>
                <button className="btn btn-primary" type="submit">
                  Ruaj
                </button>
              </div>
              <div className="detail-block settings-detail-block">
                <dl className="detail-fields settings-facts">
                  <div>
                    <dt>Emri i biznesit</dt>
                    <dd>{access.business.name}</dd>
                  </div>
                  <div>
                    <dt>Adresa në platformë</dt>
                    <dd>/{slug}</dd>
                  </div>
                  <div>
                    <dt>Katalogu</dt>
                    <dd>
                      {linked
                        ? "Lidhur me API të jashtme"
                        : "Produkte të krijuara në panel"}
                    </dd>
                  </div>
                </dl>
              </div>
              <label className="toggle-label">
                <span>
                  Përgjigje automatike
                  <small>
                    Agjenti u përgjigjet mesazheve të reja në bisedat aktive.
                  </small>
                </span>
                <input
                  type="checkbox"
                  name="auto_reply"
                  className="switch-input"
                  defaultChecked={access.business.auto_reply}
                />
              </label>
              {autoReplyBlocked && (
                <p className="muted-copy" role="status">
                  {autoReplyBlocked}{" "}
                  <a className="soft-link" href={`/b/${slug}`}>
                    Hap Dashboard →
                  </a>
                </p>
              )}
            </ActionForm>
            <section className="panel section-pad settings-agent-links" aria-labelledby="product-structure-link-title">
              <h2 id="product-structure-link-title" className="settings-heading"><span className="profile-group-icon" aria-hidden="true"><Icon name="products" size={20} /></span>Struktura</h2>
              <p className="muted-copy">Çfarë shet biznesi, fushat e çdo artikulli, stoku dhe si i sheh Agjenti, në një vend te {items.names.plural}.</p>
              <Link className="settings-agent-link" href={`/b/${slug}/products/structure`}>
                <Icon name="products" size={18} />
                <span><b>Hap strukturën</b><small>Fushat, zgjedhjet e klientit dhe stoku</small></span>
                <span aria-hidden="true">→</span>
              </Link>
            </section>
      </div>
    </>
  );
}
