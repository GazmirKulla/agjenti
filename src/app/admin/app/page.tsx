import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { getAppSettings } from "@/lib/platform/settings";
import { saveAppSettings } from "@/lib/platform/actions";
import { ActionForm } from "@/components/dashboard/action-form";
import { PageHeading } from "@/components/dashboard/ui";
import { questions } from "@/lib/onboarding/model";
export default async function AppSettingsPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const settings = await getAppSettings();
  const enabled = new Set(settings.onboarding_steps);
  return (
    <>
      <PageHeading
        eyebrow="PLATFORMA"
        title="App"
        description="Kontrollo përvojën fillestare dhe komunikimin me bizneset në Agjenti.app."
      />
      <section className="panel section-pad max-w-3xl">
        <ActionForm action={saveAppSettings} className="grid gap-6">
          <div>
            <label className="toggle-label">
              <span>Aktivizo konfigurimin automatik të biznesit</span>
              <input
                className="switch-input"
                type="checkbox"
                name="onboarding_enabled"
                defaultChecked={settings.onboarding_enabled}
              />
            </label>
            <p className="muted-copy mt-2">
              Pas emrit, përdoruesi lidh Instagram-in dhe mund të shtojë website-in.
              Analiza përgatit një konfigurim për rishikim. Kur është i fikur,
              përdoruesi vazhdon konfigurimin nga paneli dhe lidhja e Instagram-it nuk nis analizë automatike.
            </p>
          </div>
          <div>
            <p className="form-label">Hapat e alternativës manuale</p>
            <p className="muted-copy mb-3">
              Zgjidh cilat pyetje shfaqen kur përdoruesi zgjedh plotësimin manual ose me audio. Emri i biznesit
              mbetet gjithmonë i detyrueshëm. Hiq check-un për ta fshehur një
              hap.
            </p>
            <div className="grid gap-3">
              {questions.map((q) => (
                <label key={q.key} className="toggle-label">
                  <span>
                    {q.title}
                    <small>{q.label}</small>
                  </span>
                  <input
                    className="switch-input"
                    type="checkbox"
                    name="onboarding_steps"
                    value={q.key}
                    defaultChecked={enabled.has(q.key)}
                  />
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="toggle-label">
              <span>Shfaq hapat e konfigurimit në dashboard</span>
              <input
                className="switch-input"
                type="checkbox"
                name="checklist_enabled"
                defaultChecked={settings.checklist_enabled}
              />
            </label>
            <p className="muted-copy mt-2">
              Kontrollon listën udhëzuese për bizneset e krijuara përmes
              regjistrimit. Fshehja nuk kufizon asnjë funksion.
            </p>
          </div>
          <label className="form-label">
            Njoftim për bizneset
            <textarea
              className="field"
              name="announcement"
              rows={4}
              maxLength={500}
              defaultValue={settings.announcement}
              placeholder="P.sh. Njoftim për një përditësim të planifikuar…"
            />
            <span className="muted-copy">
              Shfaqet në krye të paneleve të bizneseve. Lëre bosh për ta hequr.
              Deri në 500 karaktere.
            </span>
          </label>
          <button className="btn btn-primary" type="submit">
            Ruaj cilësimet
          </button>
        </ActionForm>
      </section>
    </>
  );
}
