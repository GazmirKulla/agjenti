import { DashboardLanguageSwitch } from "@/components/dashboard/language";
import { ThemeSwitch } from "@/components/theme/theme-switch";
import s from "@/components/settings/settings.module.css";

export default function PreferencesPage() {
  return <>
    <section className={s.section}><h2>Preferencat</h2><p>Pamja ruhet në këtë shfletues. Gjuha zbatohet në panelin tënd.</p><ThemeSwitch/></section>
    <section id="language" className={s.section}><h2>Gjuha / Language</h2><p>Nuk ndryshon gjuhën e agjentit që u përgjigjet klientëve.</p><DashboardLanguageSwitch/></section>
  </>;
}
