import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { getAppSettings } from "@/lib/platform/settings";
import { saveAppSettings, saveModelTiers } from "@/lib/platform/actions";
import { ActionForm } from "@/components/dashboard/action-form";
import { Icon } from "@/components/dashboard/icon";
import { PageHeading } from "@/components/dashboard/ui";
import { questions } from "@/lib/onboarding/model";
import { agentModel, MODEL_ROLES } from "@/lib/agents/model";
import { loadModelTiers, MODEL_SUGGESTIONS, ROLE_LABELS, tierModel } from "@/lib/ai/model-choice";
import "./settings.css";

function SectionHead({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <header className="settings-section-head">
      <span className="icon-tile tone-accent"><Icon name={icon} size={20} /></span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </header>
  );
}

export default async function PlatformSettingsPage() {
  const user = await getSessionUser();
  if (!user || !(await isPlatformAdmin(user.id))) redirect("/auth/continue");
  const settings = await getAppSettings();
  const enabled = new Set(settings.onboarding_steps);
  const steps = questions.filter((q) => !["aiMode", "teamSize"].includes(q.key));
  const { tiers } = await loadModelTiers();
  return (
    <>
      <PageHeading
        eyebrow="PLATFORMA"
        title="Cilësimet"
        description="Cilësimet që vlejnë për të gjitha bizneset në Agjenti.app."
      />
      <ActionForm action={saveAppSettings} className="settings-layout">
        <section className="panel settings-section" aria-labelledby="settings-ai">
          <SectionHead icon="spark" title="Inteligjenca artificiale" description="Grupi i modeleve që përdorin të gjitha bizneset, përveç atyre me grup të vetin." />
          <fieldset className="settings-field">
            <legend className="form-label" id="settings-ai">Grupi i platformës</legend>
            {tiers.length ? <div className="settings-choice-grid settings-choice-grid-3">
              {tiers.map((tier) => (
                <label className="settings-choice" key={tier.id}>
                  <input type="radio" name="model_tier" value={tier.id} defaultChecked={settings.model_tier === tier.id} />
                  <span>
                    <strong>{tier.label}</strong>
                    {MODEL_ROLES.map((role) => <small key={role}>{ROLE_LABELS[role]}: {tierModel(tier, role)}</small>)}
                  </span>
                </label>
              ))}
            </div> : <p className="settings-hint">Duhet aplikuar migrimi i grupeve të modeleve.</p>}
            <p className="settings-hint">
              Një biznes mund të vendoset në një grup tjetër te <Link className="soft-link" href="/admin/businesses">Bizneset</Link>.
              Modelet e secilit grup ndryshohen te <a className="soft-link" href="#model-groups">Grupet e modeleve</a>.
            </p>
          </fieldset>
        </section>

        <section className="panel settings-section" aria-labelledby="settings-onboarding">
          <SectionHead icon="businesses" title="Onboarding i bizneseve të reja" description="Si krijohet hapësira dhe cilat pyetje bëhen." />
          <fieldset className="settings-field">
            <legend className="form-label" id="settings-onboarding">Mënyra</legend>
            <div className="settings-choice-grid">
              <label className="settings-choice">
                <input type="radio" name="onboarding_mode" value="manual" defaultChecked={settings.onboarding_mode === "manual"} />
                <span>
                  <strong>Manuale</strong>
                  <small>Pyetjet hap pas hapi para krijimit të hapësirës. Pyetjet e kaluara i bën më pas Asistenti në panel.</small>
                </span>
              </label>
              <label className="settings-choice">
                <input type="radio" name="onboarding_mode" value="agent" defaultChecked={settings.onboarding_mode === "agent"} />
                <span>
                  <strong>Me Asistent</strong>
                  <small>Emri dhe tipi i biznesit, pastaj Asistenti bën pyetjet e tjera një nga një brenda panelit.</small>
                </span>
              </label>
            </div>
            <p className="settings-hint">Përgjigjet e ruajtura vazhdojnë edhe kur ndryshon mënyra. Në mobile përdoret gjithmonë Asistenti.</p>
          </fieldset>
          <fieldset className="settings-field">
            <legend className="form-label">Pyetjet e konfigurimit</legend>
            <p className="settings-hint settings-hint-top">Emri i biznesit kërkohet gjithmonë. Pyetjet e fikura nuk bëhen as nga Asistenti.</p>
            <div className="settings-toggle-grid">
              {steps.map((q) => (
                <label key={q.key} className="settings-toggle">
                  <span>
                    {q.label}
                    <small>{q.title}</small>
                  </span>
                  <input className="switch-input" type="checkbox" name="onboarding_steps" value={q.key} defaultChecked={enabled.has(q.key)} />
                </label>
              ))}
            </div>
            <Link className="soft-link settings-link" href="/admin/onboarding">Shiko si formojnë përgjigjet profilin →</Link>
          </fieldset>
        </section>

        <section className="panel settings-section" aria-labelledby="settings-dashboard">
          <SectionHead icon="dashboard" title="Paneli i bizneseve" description="Çfarë shohin bizneset në panelin e tyre." />
          <label className="settings-toggle settings-toggle-wide">
            <span id="settings-dashboard">
              Hapat e konfigurimit në dashboard
              <small>Lista udhëzuese për bizneset e reja. Fshehja nuk kufizon asnjë funksion.</small>
            </span>
            <input className="switch-input" type="checkbox" name="checklist_enabled" defaultChecked={settings.checklist_enabled} />
          </label>
          <div className="settings-field">
            <label className="form-label" htmlFor="announcement">Njoftim për bizneset</label>
            <textarea className="field" id="announcement" name="announcement" rows={3} maxLength={500}
              defaultValue={settings.announcement} placeholder="P.sh. Njoftim për një përditësim të planifikuar…" />
            <p className="settings-hint">Shfaqet në krye të paneleve të bizneseve. Lëre bosh për ta hequr. Deri në 500 karaktere.</p>
          </div>
        </section>

        <section className="panel settings-section" aria-labelledby="settings-integrations">
          <SectionHead icon="instagram" title="Integrimet" description="Çfarë ndodh kur një biznes lidh kanalet e tij." />
          <label className="settings-toggle settings-toggle-wide">
            <span id="settings-integrations">
              Analiza automatike e Instagram-it
              <small>Kur biznesi lidh Instagram-in, analiza përgatit profilin dhe njohuritë për rishikim. E fikur: lidhja nuk nis analizë.</small>
            </span>
            <input className="switch-input" type="checkbox" name="onboarding_enabled" defaultChecked={settings.onboarding_enabled} />
          </label>
        </section>

        <div className="settings-savebar">
          <p>Ndryshimet vlejnë për të gjitha bizneset në hapjen ose rifreskimin e ardhshëm të faqeve.</p>
          <button className="btn btn-primary" type="submit">Ruaj cilësimet</button>
        </div>
      </ActionForm>

      <ActionForm action={saveModelTiers} className="settings-layout settings-groups">
        <section className="panel settings-section" id="model-groups" aria-labelledby="settings-groups">
          <SectionHead icon="settings" title="Grupet e modeleve" description="Çdo grup ka një model për secilin lloj pune. Bosh përdor parazgjedhjen e serverit." />
          <datalist id="model-suggestions">{MODEL_SUGGESTIONS.map((model) => <option key={model} value={model} />)}</datalist>
          <p className="settings-hint" id="settings-groups">
            Parazgjedhja e serverit: <strong>{agentModel()}</strong>. Modelet e reja kontrollohen te OpenAI para ruajtjes.
          </p>
          <div className="settings-group-grid">
            {tiers.map((tier) => (
              <fieldset className="settings-group" key={tier.id}>
                <legend className="sr-only">{tier.label}</legend>
                <label className="form-label">Emri i grupit
                  <input className="field" name={`${tier.id}:label`} defaultValue={tier.label} maxLength={40} required />
                </label>
                {MODEL_ROLES.map((role) => (
                  <label className="form-label" key={role}>{ROLE_LABELS[role]}
                    <input className="field" name={`${tier.id}:${role}`} list="model-suggestions" maxLength={80}
                      defaultValue={tier[`${role}_model`] ?? ""} placeholder={agentModel()} autoComplete="off" spellCheck={false} />
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="settings-group-actions">
            <button className="btn btn-ghost" type="submit">Ruaj grupet</button>
          </div>
        </section>
      </ActionForm>
    </>
  );
}
