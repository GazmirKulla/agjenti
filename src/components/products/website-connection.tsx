import Link from "next/link";
import { Icon } from "@/components/dashboard/icon";
import { getDashboardTranslator } from "@/lib/dashboard/language/server";
import { createServiceSupabase } from "@/lib/supabase/service";

/**
 * The business website on Produktet, as one thin row above the list so the products stay in view.
 * Linked: its address, "I lidhur", "Sinkronizo" and the connection's settings behind a gear.
 * Not linked: only "Merr produktet nga webi", which opens the connection form.
 * How many products came from it is told by the list's "Nga webi" tab, not repeated here.
 */
export async function WebsiteConnection({ slug, businessId, linkedCount }: { slug: string; businessId: string; linkedCount: number }) {
  const t = await getDashboardTranslator();
  const { data, error } = await createServiceSupabase()
    .from("integrations").select("catalog_url").eq("business_id", businessId).eq("kind", "http").maybeSingle();
  const url = data?.catalog_url?.trim() || null;
  const host = url ? (() => { try { return new URL(url).host; } catch { return url; } })() : null;
  const settings = `/b/${slug}/products?detail=website`;

  if (error) return <section className="website-connection" aria-label={t("Webi i biznesit")}>
    <Icon name="globe" size={18} />
    <span className="website-connection-text">{t("Nuk u ngarkua konfigurimi i webit.")}</span>
    <Link className="website-connection-settings" href={settings} scroll={false} aria-label={t("Cilësimet e lidhjes")} title={t("Cilësimet e lidhjes")}><Icon name="settings" size={18} /></Link>
  </section>;

  if (!url) return <Link className="website-connection is-unlinked" href={settings} scroll={false}
    title={linkedCount ? t("Lidhe që çmimet dhe porositë të përditësohen vetë.") : t("Lidh webin që produktet, çmimet dhe porositë të vijnë drejt nga webi.")}>
    <Icon name="link" size={16} /> {t("Merr produktet nga webi")}
  </Link>;

  return <section className="website-connection is-linked" aria-label={t("Webi i biznesit")}>
    <span className="website-connection-icon" aria-hidden><Icon name="globe" size={18} /></span>
    <span className="website-connection-text"><strong>{host}</strong><span className="website-connection-state is-on">{t("I lidhur")}</span></span>
    <Link className="btn btn-ghost website-connection-sync" href={`/b/${slug}/products/imports`} title={t("Sinkronizo produktet")}>
      <Icon name="refresh" size={16} /> {t("Sinkronizo")}
    </Link>
    <Link className="website-connection-settings" href={settings} scroll={false} aria-label={t("Cilësimet e lidhjes")} title={t("Cilësimet e lidhjes")}>
      <Icon name="settings" size={18} />
    </Link>
  </section>;
}
