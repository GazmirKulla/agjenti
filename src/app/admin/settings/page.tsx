import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { getAppSettings } from "@/lib/platform/settings";
import { saveAppSettings, saveConversationLearning, saveModelTiers } from "@/lib/platform/actions";
import { learningLimits, loadLearningSettings } from "@/lib/conversation-learning/settings";
import { ActionForm } from "@/components/dashboard/action-form";
import { Icon } from "@/components/dashboard/icon";
import { PageHeading } from "@/components/dashboard/ui";
import { questions } from "@/lib/onboarding/model";
import { agentModel, MODEL_ROLES } from "@/lib/agents/model";
import { loadModelTiers, MODEL_SUGGESTIONS, ROLE_LABELS } from "@/lib/ai/model-choice";
import { createServiceSupabase } from "@/lib/supabase/service";
import "./settings.css";

const ROLE_HINTS = {
  customer: "Kuptimi i mesazhit, katalogu dhe përgjigjja te klienti.",
  assistant: "Planet, ndryshimet, importet dhe analizat për pronarin.",
  utility: "Klasifikime të shkurtra që ndodhin shpesh.",
} as const;

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
  const learning = await loadLearningSettings();
  // How many businesses chose each group themselves (the rest follow the platform).
  const { data: chosen } = await createServiceSupabase().from("businesses").select("model_tier").not("model_tier", "is", null);
  const businessesByTier = new Map<string, number>();
  for (const row of chosen ?? []) businessesByTier.set(row.model_tier, (businessesByTier.get(row.model_tier) ?? 0) + 1);
  return (
    <>
      <PageHeading
        eyebrow="PLATFORMA"
        title="Cilësimet"
        description="Cilësimet që vlejnë për të gjitha bizneset në Agjenti.app."
      />
      <ActionForm action={saveModelTiers} className="settings-layout settings-ai-form">
        <section className="panel settings-section" aria-labelledby="settings-ai">
          <SectionHead icon="spark" title="Modelet e AI" description="Çdo grup ka një model për secilin lloj pune. Platforma përdor një grup; një biznes mund të ketë grupin e vet." />
          <datalist id="model-suggestions">{MODEL_SUGGESTIONS.map((model) => <option key={model} value={model} />)}</datalist>
          {tiers.length ? <div className="model-matrix-scroll">
            <table className="model-matrix">
              <caption className="sr-only" id="settings-ai">Modelet sipas grupit dhe llojit të punës</caption>
              <thead>
                <tr>
                  <th scope="col" className="model-matrix-corner">Lloji i punës</th>
                  {tiers.map((tier) => (
                    <th scope="col" key={tier.id} className={settings.model_tier === tier.id ? "is-platform" : undefined}>
                      <input className="field model-matrix-name" name={`${tier.id}:label`} defaultValue={tier.label} maxLength={40} required aria-label={`Emri i grupit ${tier.label}`} />
                      <label className="model-matrix-platform">
                        <input type="radio" name="model_tier" value={tier.id} defaultChecked={settings.model_tier === tier.id} />
                        <span>Grupi i platformës</span>
                      </label>
                      <small className="model-matrix-count">
                        {(businessesByTier.get(tier.id) ?? 0) === 0 ? "Asnjë biznes specifik" : `${businessesByTier.get(tier.id)} biznes${businessesByTier.get(tier.id) === 1 ? "" : "e"} specifik${businessesByTier.get(tier.id) === 1 ? "" : "e"}`}
                      </small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODEL_ROLES.map((role) => (
                  <tr key={role}>
                    <th scope="row">
                      {ROLE_LABELS[role]}
                      <small>{ROLE_HINTS[role]}</small>
                    </th>
                    {tiers.map((tier) => (
                      <td key={tier.id} className={settings.model_tier === tier.id ? "is-platform" : undefined}>
                        <input className="field" name={`${tier.id}:${role}`} list="model-suggestions" maxLength={80}
                          defaultValue={tier[`${role}_model`] ?? ""} placeholder={agentModel()} autoComplete="off" spellCheck={false}
                          aria-label={`${ROLE_LABELS[role]} · ${tier.label}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div> : <p className="settings-hint">Duhet aplikuar migrimi i grupeve të modeleve.</p>}
          <div className="settings-inline-actions">
            <p className="settings-hint">
              Bosh përdor parazgjedhjen e serverit (<strong>{agentModel()}</strong>). Modelet e reja kontrollohen te OpenAI para ruajtjes.
              Grupin e një biznesi e zgjedh te <Link className="settings-text-link" href="/admin/businesses">Bizneset</Link>.
            </p>
            <button className="btn btn-primary" type="submit">Ruaj modelet</button>
          </div>
        </section>
      </ActionForm>

      <ActionForm action={saveConversationLearning} className="settings-layout">
        <section className="panel settings-section" aria-labelledby="settings-learning">
          <SectionHead icon="chat" title="Mësimi nga bisedat" description="Te Njohuritë, Agjenti lexon bisedat e fundit me klientët dhe sugjeron njohuri që pronari i miraton një nga një. Asgjë nuk ruhet pa miratimin e tij." />
          {!learning.stored && (
            <p className="settings-hint settings-hint-top">Vlerat më poshtë janë parazgjedhjet që po përdoren. Për t&apos;i ndryshuar, duhet aplikuar migrimi <code>conversation_learning_settings</code>.</p>
          )}
          <label className="settings-toggle settings-toggle-wide">
            <span id="settings-learning">
              Mësimi nga bisedat aktiv
              <small>E fikur: butoni «Mëso nga bisedat» nuk shfaqet te asnjë biznes.</small>
            </span>
            <input className="switch-input" type="checkbox" name="learning_enabled" defaultChecked={learning.settings.enabled} disabled={!learning.stored} />
          </label>
          <div className="settings-number-grid">
            {([
              ["learning_min_conversations", "min_conversations", "Bisedat minimale", "Skanimi hapet vetëm kur biznesi ka të paktën kaq biseda në periudhën më poshtë."],
              ["learning_messages_per_conversation", "messages_per_conversation", "Mesazhe për bisedë", "Mesazhet e fundit që lexohen nga çdo bisedë. Instagram jep deri në 20."],
              ["learning_max_conversations", "max_conversations", "Bisedat për skanim", "Sa biseda lexohen në një skanim, nga më e reja."],
              ["learning_lookback_days", "lookback_days", "Periudha (ditë)", "Lexohen vetëm bisedat aktive në kaq ditët e fundit."],
            ] as const).map(([name, key, label, hint]) => (
              <label key={name} className="form-label settings-number">
                {label}
                <input className="field" type="number" name={name} min={learningLimits[key].min} max={learningLimits[key].max}
                  defaultValue={learning.settings[key]} required disabled={!learning.stored} />
                <small className="settings-hint">{hint} ({learningLimits[key].min}–{learningLimits[key].max})</small>
              </label>
            ))}
          </div>
          <label className="settings-toggle settings-toggle-wide">
            <span>
              Historia e Instagram-it
              <small>Lexon edhe DM-të nga përpara lidhjes së Instagram-it (Meta jep 20 mesazhet e fundit të çdo bisede). WhatsApp nuk jep histori.</small>
            </span>
            <input className="switch-input" type="checkbox" name="learning_instagram_history" defaultChecked={learning.settings.instagram_history} disabled={!learning.stored} />
          </label>
          <div className="settings-inline-actions">
            <p className="settings-hint">Kontaktet (telefon, email) hiqen para se bisedat t&apos;i lexojë AI; emrat e klientëve nuk dërgohen.</p>
            {learning.stored && <button className="btn btn-primary" type="submit">Ruaj mësimin nga bisedat</button>}
          </div>
        </section>
      </ActionForm>

      <ActionForm action={saveAppSettings} className="settings-layout">
        <section className="panel settings-section" aria-labelledby="settings-onboarding">
          <SectionHead icon="businesses" title="Onboarding i bizneseve të reja" description="Cilat pyetje bëhen kur krijohet një biznes i ri." />
          <fieldset className="settings-field">
            <legend className="form-label" id="settings-onboarding">Pyetjet e konfigurimit</legend>
            <p className="settings-hint settings-hint-top">Emri i biznesit kërkohet gjithmonë. Pyetjet e fikura nuk bëhen as te karta «Gati për klientët» në panel.</p>
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

    </>
  );
}
