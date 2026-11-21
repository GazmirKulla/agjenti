import { setupGateMessage } from "@/lib/setup/model";
import { loadSetupStatus } from "@/lib/setup/status";
import { setBusinessAutoReply } from "@/lib/agents/auto-reply";
import { ActionForm } from "@/components/dashboard/action-form";
import { loadItemSetup } from "@/lib/items/business";
import Link from "next/link";
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
            <p className="muted-copy">
              Përshkrimi i biznesit, oferta dhe pyetjet e shpeshta ruhen te{" "}
              <Link className="soft-link" href={`/b/${slug}/knowledge`}>Njohuritë</Link>, ku i lexon Agjenti.
            </p>
            <BusinessLogoSettings slug={slug} name={access.business.name} logoUrl={logo?.url ?? null} source={logo?.source ?? null}
              instagramConnected={Boolean(instagram)} available={Boolean(logo)} />
            <ActionForm
              action={saveBusiness}
              className="panel section-pad grid gap-5"
            >
              <div className="section-title">
                <h2>Të dhënat e biznesit</h2>
                <button className="btn btn-primary" type="submit">
                  Ruaj
                </button>
              </div>
              <div className="detail-block settings-detail-block">
                <dl className="detail-fields">
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
            <section className="panel section-pad grid gap-3" aria-labelledby="product-structure-link-title">
              <h2 id="product-structure-link-title">Struktura</h2>
              <p className="muted-copy">
                Çfarë shet biznesi, fushat e çdo artikulli, stoku dhe si i sheh Agjenti menaxhohen në një vend te {items.names.plural}.{" "}
                <Link className="soft-link" href={`/b/${slug}/products/structure`}>Hap strukturën →</Link>
              </p>
            </section>
      </div>
    </>
  );
}
