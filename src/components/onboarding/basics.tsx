"use client";
import { activeQuestions, type AnswerKey, type Answers } from "@/lib/onboarding/model";

export function OnboardingBasics({ answers, enabledSteps, busy, onChange, onContinue }: {
  answers: Answers;
  enabledSteps: AnswerKey[];
  busy: boolean;
  onChange: (field: string, value: string | string[]) => void;
  onContinue: (mode: "audio" | "written") => Promise<void>;
}) {
  const questions = activeQuestions(enabledSteps, answers);
  const business = questions.find((q) => q.key === "businessType");
  const goals = questions.find((q) => q.key === "useCases");
  const goalOptions = goals?.options.filter(([id]) =>
    ["support", "orders", "booking", "leads"].includes(id) || answers.useCases.includes(id),
  ) ?? [];
  const valid = answers.name.trim().length >= 2 && (!business || !!answers.businessType);
  return (
    <form onSubmit={(event) => { event.preventDefault(); void onContinue("audio"); }}>
      <fieldset disabled={busy} className="onboarding-basics">
        <div className="onboarding-intro">
          <label htmlFor="basics-name">Si quhet biznesi?</label>
          <input id="basics-name" autoComplete="organization" value={answers.name}
            minLength={2} maxLength={100} required placeholder="Emri i biznesit tënd"
            onChange={(event) => onChange("name", event.target.value)} />
        </div>
        {business && (
          <label className="onboarding-detail-input" htmlFor="basics-business">
            <strong>Çfarë lloj biznesi ke?</strong>
            <select id="basics-business" value={answers.businessType} required
              onChange={(event) => onChange("businessType", event.target.value)}>
              <option value="">Zgjidh llojin e biznesit</option>
              {business.options.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        )}
        {goals && (
          <section aria-labelledby="basics-goals">
            <h2 id="basics-goals">Për çfarë dëshiron ndihmë nga Agjenti?</h2>
            <p className="onboarding-basics-hint">Mund të zgjedhësh disa. Nëse nuk je i sigurt, mund ta vendosësh pas përshkrimit.</p>
            <div className="onboarding-options">
              {goalOptions.map(([id, label]) => (
                <label key={id} className={`onboarding-option ${answers.useCases.includes(id) ? "selected" : ""}`}>
                  <input type="checkbox" name="basic-goals" checked={answers.useCases.includes(id)}
                    onChange={() => onChange("useCases", answers.useCases.includes(id)
                      ? answers.useCases.filter((value) => value !== id) : [...answers.useCases, id])} />
                  <span>{label}</span>
                  <span className="onboarding-choice" aria-hidden="true">{answers.useCases.includes(id) ? "✓" : ""}</span>
                </label>
              ))}
            </div>
            <button className="onboarding-skip" type="button" onClick={() => onChange("useCases", [])}>
              Nuk jam ende i sigurt
            </button>
          </section>
        )}
        <div className="onboarding-actions onboarding-basics-actions">
          <button className="onboarding-back" type="button" disabled={!valid || busy}
            onClick={() => void onContinue("written")}>Përgjigju me shkrim</button>
          <button className="onboarding-next" type="submit" disabled={!valid || busy}>
            {busy ? "Duke ruajtur…" : "Vazhdo me audio →"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
