import { developerPromptEn } from "./website-prompt-en";
import { getDashboardLanguage } from "@/lib/dashboard/language/server";
import { getDashboardTranslator } from "@/lib/dashboard/language/server";
import { ActionForm } from "@/components/dashboard/action-form";
import { IntegrationApiKeyField } from "@/components/dashboard/integration-api-key";
import { IntegrationProbe } from "@/components/dashboard/integration-probe";
import { WebsiteDeveloperPrompt } from "@/components/dashboard/website-developer-prompt";
import styles from "./website-integration.module.css";
import { WebsiteSpecifications, developerPrompt } from "@/components/dashboard/website-specifications";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

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

export async function WebsiteIntegration({ slug }: { slug: string }) {
  const t = await getDashboardTranslator();
  const language = await getDashboardLanguage();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
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
    const { data: existing, error: existingError } = await db
      .from("integrations")
      .select("secret_ciphertext")
      .eq("business_id", acc.business.id)
      .eq("kind", "http")
      .maybeSingle();

    if (existingError) return { error: "Nuk u lexua lidhja ekzistuese." };

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
      .eq("kind", "http")
      .throwOnError();
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
  if (integrationError) throw new Error(t("Nuk u ngarkua integrimi i biznesit."));

  const linked = Boolean(integration?.catalog_url?.trim());
  let storedSecret: string | null = null;
  if (integration?.secret_ciphertext) {
    try {
      storedSecret = decryptSecret(integration.secret_ciphertext);
    } catch {
      storedSecret = null;
    }
  }
  return <div className={styles.content}>
    <WebsiteDeveloperPrompt prompt={language === "en" ? developerPromptEn : developerPrompt} />
    <ActionForm localized action={saveExternalCatalog} className={`website-integration-form ${styles.form}`}>
      <div className="section-title">
        <h2>{t("2. Lidh webin")}</h2>
        <span className="muted-copy">{linked ? t("E konfiguruar") : t("E pakonfiguruar")}</span>
      </div>
      <label className="form-label">
        {t("URL e katalogut")}<input type="url" name="catalog_url" defaultValue={integration?.catalog_url ?? ""}
          placeholder="https://webi-juaj.al/…/catalog" className="field" />
      </label>
      <label className="form-label">
        {t("URL e porosive (opsionale)")}<input type="url" name="orders_url" defaultValue={integration?.orders_url ?? ""}
          placeholder="https://webi-juaj.al/…/orders" className="field" />
      </label>
      <IntegrationApiKeyField hasStoredSecret={Boolean(integration?.secret_ciphertext)} storedSecret={storedSecret} />
      <IntegrationProbe businessId={access.business.id} formSelector="form.website-integration-form" compact />
      <button className="btn btn-primary w-fit" type="submit">{t("Ruaj lidhjen")}</button>
    </ActionForm>
    <WebsiteSpecifications language={language} />
    {linked && <ActionForm localized action={disconnectExternalCatalog}>
      <button className="btn btn-ghost text-danger" type="submit">{t("Shkëput webin")}</button>
    </ActionForm>}
  </div>;
}
