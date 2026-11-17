import Link from "next/link";
import { Icon } from "@/components/dashboard/icon";
import { getDashboardTranslator } from "@/lib/dashboard/language/server";
import { createServiceSupabase } from "@/lib/supabase/service";

/**
 * The business website on Produktet: whether its catalog is connected, how many
 * products come from it, and the way to connect or manage it (the same
 * configuration that used to sit under Kanalet).
 */
export async function WebsiteConnection({ slug, businessId, linkedCount }: { slug: string; businessId: string; linkedCount: number }) {
  const t = await getDashboardTranslator();
  const { data, error } = await createServiceSupabase()
    .from("integrations").select("catalog_url").eq("business_id", businessId).eq("kind", "http").maybeSingle();
  const url = data?.catalog_url?.trim() || null;
  const host = url ? (() => { try { return new URL(url).host; } catch { return url; } })() : null;
  const settings = `/b/${slug}/products?detail=website`;
  // Unlinked, it is a small suggestion beside the catalog, not the first thing on the page.
  return <section className={`website-connection${url ? " is-linked" : " is-compact"}`} aria-label={t("Webi i biznesit")}>
    <span className="website-connection-icon" aria-hidden><Icon name="display" size={22} /></span>
    <div className="website-connection-text">
      <strong>
        {t("Webi i biznesit")}
        <span className={`website-connection-state${url ? " is-on" : ""}`}>{error ? t("Statusi nuk u ngarkua") : url ? t("I lidhur") : t("I palidhur")}</span>
      </strong>
      <p>{error ? t("Nuk u ngarkua konfigurimi i webit.")
        : url ? `${host} · ${linkedCount === 1 ? t("1 produkt nga webi") : `${linkedCount} ${t("produkte nga webi")}`}`
        : linkedCount ? `${linkedCount === 1 ? t("1 produkt erdhi nga webi") : `${linkedCount} ${t("produkte erdhën nga webi")}`}. ${t("Lidhe që çmimet dhe porositë të përditësohen vetë.")}`
        : t("Lidh webin që produktet, çmimet dhe porositë të vijnë drejt nga webi.")}</p>
    </div>
    <div className="website-connection-actions">
      {url ? <>
        <Link className="btn btn-primary" href={`/b/${slug}/products/imports`}>{t("Lidh produktet e webit")}</Link>
        <Link className="btn btn-ghost" href={settings} scroll={false}>{t("Menaxho lidhjen")}</Link>
      </> : <Link className="btn btn-ghost" href={settings} scroll={false}><Icon name="link" size={16} /> {t("Lidh me webin")}</Link>}
    </div>
  </section>;
}
