"use client";
import { activeQuestions, type AnswerKey, type Answers } from "@/lib/onboarding/model";

export function OnboardingBasics({ answers, enabledSteps, busy, onChange, onContinue }: {
  answers: Answers;
  enabledSteps: AnswerKey[];
  busy: boolean;
  onChange: (field: string, value: string | string[]) => void;
  onContinue: () => Promise<void>;
}) {
  const questions = activeQuestions(enabledSteps, answers);
  const business = questions.find((q) => q.key === "businessType");
  const valid = answers.name.trim().length >= 2 && (!business || !!answers.businessType);
  return (
    <form onSubmit={(event) => { event.preventDefault(); void onContinue(); }}>
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
        <div className="onboarding-actions onboarding-basics-actions">
          <button className="onboarding-next" type="submit" disabled={!valid || busy}>
            {busy ? "Duke ruajtur…" : "Vazhdo →"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
