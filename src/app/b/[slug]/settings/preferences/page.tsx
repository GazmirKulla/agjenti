import { DashboardLanguageSwitch } from "@/components/dashboard/language";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import s from "@/components/settings/settings.module.css";
import { manualCommandActor } from "@/lib/actions/command-actor";
import { createServiceSupabase } from "@/lib/supabase/service";
import { OperationButton } from "@/components/dashboard/operation-button";

export default async function PreferencesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await manualCommandActor(slug);
  const preference = await createServiceSupabase().from("business_attention_preferences").select("enabled,checked_at")
    .eq("business_id", actor.business.id).eq("user_id", actor.userId).maybeSingle();
  if (preference.error) throw Error("Preferenca e ndjekjes nuk u ngarkua.");
  const enabled = preference.data?.enabled ?? false;
  return <>
    <section className={s.section}><h2>Preferencat</h2><p>Pamja ruhet në këtë shfletues. Gjuha zbatohet në panelin tënd.</p><ThemeSwitch/></section>
    <section id="language" className={s.section}><h2>Gjuha / Language</h2><p>Nuk ndryshon gjuhën e agjentit që u përgjigjet klientëve.</p><DashboardLanguageSwitch/></section>
    <section className={s.section}><h2>Ndjekja e punëve</h2>
      <p>Kontroll ditor për punët e pambaruara, bisedat e stafit dhe gabimet e sinkronizimit. Njoftimet shfaqen te Aktiviteti kur ka ndryshime që kërkojnë vëmendje. Veprimet mbeten në pritje të konfirmimit tënd.</p>
      <p>Gjendja: {enabled ? "Aktive" : "Joaktive"}.</p>
      <OperationButton slug={actor.business.slug} operation="attention.configure" input={{ enabled: !enabled }}>{enabled ? "Çaktivizo njoftimet" : "Aktivizo njoftimet"}</OperationButton>
    </section>
  </>;
}
