import { loadSetupStatus } from "@/lib/setup/status";
import { setupGateMessage } from "@/lib/setup/model";
import { ActionForm } from "@/components/dashboard/action-form";
import { DeleteBusinessPanel } from "@/components/dashboard/delete-business";
import { IntegrationApiKeyField } from "@/components/dashboard/integration-api-key";
import { IntegrationProbe } from "@/components/dashboard/integration-probe";
import { ModulesSettingsPanel } from "@/components/dashboard/modules-settings";
import { BusinessProfile } from "@/components/dashboard/business-profile";
import { PageHeading, StatusBadge } from "@/components/dashboard/ui";
import { Icon } from "@/components/dashboard/icon";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";

function parseOptionalUrl(value: string): string | null | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol))
      return { error: "URL-të duhet të fillojnë me https:// ose http://." };
    return url.toString();
  } catch {
    return { error: "Vendos URL të vlefshme për katalogun dhe porositë." };
  }
}

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
    if (formData.get("auto_reply") === "on" && !acc.business.auto_reply) {
      const blocked = setupGateMessage(await loadSetupStatus(acc.business.id));
      if (blocked) return { error: blocked };
    }
    const db = createServiceSupabase();
    if (formData.get("auto_reply") === "on" && !acc.business.auto_reply) {
      const { error } = await db.rpc("launch_business", {
        p_business_id: acc.business.id,
        p_automatic: true,
      });
      if (error)
        return {
          error: "Konfigurimi ndryshoi. Kontrollo hapat nga Dashboard.",
        };
    }
    await db
      .from("businesses")
      .update({ auto_reply: formData.get("auto_reply") === "on" })
      .eq("id", acc.business.id)
      .throwOnError();
    revalidatePath(`/b/${slug}`, "layout");
    return { success: "Cilësimet e biznesit u ruajtën." };
  }

  async function saveExternalCatalog(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };

    const catalogRaw = String(formData.get("catalog_url") ?? "").trim();
    if (!catalogRaw)
      return {
        error:
          "Vendos URL-në e katalogut. Për ta hequr lidhjen, përdor «Shkëput».",
      };
    const catalogUrl = parseOptionalUrl(catalogRaw);
    if (catalogUrl && typeof catalogUrl === "object") return catalogUrl;
    const ordersUrl = parseOptionalUrl(String(formData.get("orders_url") ?? ""));
    if (ordersUrl && typeof ordersUrl === "object") return ordersUrl;

    const apiSecret = String(formData.get("api_secret") ?? "").trim();
    if (apiSecret && apiSecret.length < 16)
      return { error: "API key duhet të ketë të paktën 16 karaktere." };

    const db = createServiceSupabase();
    const { data: existing } = await db
      .from("integrations")
      .select("secret_ciphertext")
      .eq("business_id", acc.business.id)
      .eq("kind", "http")
      .maybeSingle();

    const secretCiphertext = apiSecret
      ? encryptSecret(apiSecret)
      : (existing?.secret_ciphertext ?? null);
    if (!secretCiphertext)
      return { error: "Vendos API key për katalogun e jashtëm." };

    await db
      .from("integrations")
      .upsert(
        {
          business_id: acc.business.id,
          kind: "http",
          catalog_url: catalogUrl,
          orders_url: ordersUrl,
          secret_ciphertext: secretCiphertext,
        },
        { onConflict: "business_id,kind" },
      )
      .throwOnError();

    await db
      .from("businesses")
      .update({ catalog_source: "external" })
      .eq("id", acc.business.id)
      .throwOnError();

    revalidatePath(`/b/${slug}`, "layout");
    return { success: "Lidhja me katalogun e jashtëm u ruajt." };
  }

  async function disconnectExternalCatalog() {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    const db = createServiceSupabase();
    await db
      .from("integrations")
      .delete()
      .eq("business_id", acc.business.id)
      .eq("kind", "http");
    await db
      .from("businesses")
      .update({ catalog_source: "internal" })
      .eq("id", acc.business.id)
      .throwOnError();
    revalidatePath(`/b/${slug}`, "layout");
    return { success: "Lidhja me katalogun e jashtëm u shkëput." };
  }

  const { data: integration, error: integrationError } =
    await createServiceSupabase()
      .from("integrations")
      .select("catalog_url,orders_url,secret_ciphertext")
      .eq("business_id", access.business.id)
      .eq("kind", "http")
      .maybeSingle();
  if (integrationError) throw new Error("Nuk u ngarkua integrimi i biznesit.");

  const linked = Boolean(integration?.catalog_url?.trim());
  let storedSecret: string | null = null;
  if (integration?.secret_ciphertext) {
    try {
      storedSecret = decryptSecret(integration.secret_ciphertext);
    } catch {
      storedSecret = null;
    }
  }
  const autoReplyBlocked = access.business.auto_reply
    ? null
    : setupGateMessage(await loadSetupStatus(access.business.id));
  const dashboardProfile = await loadDashboardProfile(access.business.id);
  const { data: onboarding, error: onboardingError } = await createServiceSupabase()
    .from("business_onboarding")
    .select("answers")
    .eq("business_id", access.business.id)
    .maybeSingle();

  return (
    <>
      <PageHeading
        eyebrow="Cilësimet"
        title={access.business.name}
        description="Shiko profilin e biznesit dhe menaxho cilësimet, modulet dhe lidhjet e katalogut."
      />
      <nav className="settings-tabs" aria-label="Seksionet e cilësimeve">
        <a href="#business-profile">
          <Icon name="businesses" size={16} />
          Profili
        </a>
        <a href="#business-data">Të dhënat</a>
        <a href="#modules">Modulet</a>
        <a href="#external-catalog">Katalogu</a>
      </nav>
      <div className="configuration-layout">
        <div className="space-y-5">
          <BusinessProfile
            answers={onboarding?.answers}
            slug={slug}
            failed={!!onboardingError}
          />
          <div id="business-data">
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
          </div>

          <div id="modules">
            <ModulesSettingsPanel
              slug={slug}
              businessId={access.business.id}
              profile={dashboardProfile}
            />
          </div>

          <div id="external-catalog" className="grid gap-3">
            <ActionForm
              action={saveExternalCatalog}
              className="panel section-pad grid gap-5 business-settings-form"
            >
              <div className="section-title">
                <h2>Katalog i jashtëm</h2>
                <StatusBadge status={linked ? "connected" : "draft"} />
              </div>
              <p className="muted-copy">
                Plotëso URL-të dhe API key për të lidhur katalogun. Pa këtë
                lidhje, përdoren vetëm produktet e krijuara te Produktet.
              </p>
              <label className="form-label">
                URL e katalogut
                <input
                  type="url"
                  name="catalog_url"
                  defaultValue={integration?.catalog_url ?? ""}
                  placeholder="https://…/catalog"
                  className="field"
                />
              </label>
              <label className="form-label">
                URL e porosive
                <input
                  type="url"
                  name="orders_url"
                  defaultValue={integration?.orders_url ?? ""}
                  placeholder="https://…/orders"
                  className="field"
                />
              </label>
              <IntegrationApiKeyField
                hasStoredSecret={Boolean(integration?.secret_ciphertext)}
                storedSecret={storedSecret}
              />
              <IntegrationProbe
                businessId={access.business.id}
                formSelector="form.business-settings-form"
              />
              <button className="btn btn-primary w-fit" type="submit">
                Ruaj lidhjen
              </button>
            </ActionForm>
            {linked && (
              <ActionForm action={disconnectExternalCatalog}>
                <button className="btn btn-ghost" type="submit">
                  Shkëput katalogun e jashtëm
                </button>
              </ActionForm>
            )}
          </div>
        </div>
        <aside className="settings-side">
          <section className="panel section-pad grid gap-4">
            <span className="icon-tile">
              <Icon name="products" size={25} />
            </span>
            <div className="grid gap-2">
              <h2 className="text-lg">Si funksionon</h2>
              <p className="muted-copy">
                Dy mënyra: produkte të krijuara në panel, ose lidhje me katalog
                të jashtëm. Nuk ka zgjedhës — mjafton të plotësosh këtë seksion.
              </p>
              <p className="muted-copy">
                Vendos URL + API key, testo lidhjen, pastaj lidh produktet nga
                faqja Produkte.
              </p>
            </div>
          </section>
          <DeleteBusinessPanel
            businessId={access.business.id}
            slug={slug}
            businessName={access.business.name}
            redirectTo="/auth/continue"
          />
        </aside>
      </div>
    </>
  );
}
