"use client";
import { activeQuestions, type AnswerKey, type Answers } from "@/lib/onboarding/model";
import { Icon } from "@/components/dashboard/icon";

export function OnboardingBasics({ answers, enabledSteps, busy, onChange, onContinue }: {
  answers: Answers;
  enabledSteps: AnswerKey[];
  busy: boolean;
  onChange: (field: string, value: string | string[]) => void;
  onContinue: () => Promise<void>;
}) {
  const questions = activeQuestions(enabledSteps, answers);
  const business = questions.find((q) => q.key === "businessType");
  const valid = answers.name.trim().length >= 2 && (!business ||
    (!!answers.businessType && (answers.businessType !== "other" || (answers.details?.categoryDescription?.trim().length ?? 0) >= 2)));
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
          <section className="onboarding-categories" aria-labelledby="basics-category-title">
            <h2 id="basics-category-title">Çfarë biznesi ke?</h2>
            <div className="onboarding-category-grid" role="radiogroup" aria-labelledby="basics-category-title">
              {business.options.map(([id, label, icon]) => (
                <label key={id} className={`onboarding-option onboarding-category-card ${answers.businessType === id ? "selected" : ""}`}>
                  <input type="radio" name="business-category" value={id} required
                    checked={answers.businessType === id} onChange={() => onChange("businessType", id)} />
                  <Icon name={icon} size={26} />
                  <span>{label}</span>
                  <span className="onboarding-choice" aria-hidden="true">{answers.businessType === id ? "✓" : ""}</span>
                </label>
              ))}
            </div>
            {answers.businessType === "other" && (
              <label className="onboarding-detail-input" htmlFor="basics-category-description">
                Përshkruaje shkurt biznesin
                <input id="basics-category-description" value={answers.details?.categoryDescription ?? ""}
                  required minLength={2} maxLength={500} placeholder="P.sh. studio fotografike"
                  onChange={(event) => onChange("categoryDescription", event.target.value)} />
              </label>
            )}
          </section>
        )}
        <div className="onboarding-actions onboarding-basics-actions">
          <button className="onboarding-next" type="submit" disabled={!valid || busy}>
            {busy ? "Duke ruajtur…" : "Vazhdo"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
