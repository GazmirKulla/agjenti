import { DETAIL_QUESTIONS } from "@/lib/onboarding/detail-questions";
import { ONBOARDING_STEPS } from "@/lib/onboarding/steps";

/** Admin "Onboarding Flow": the order of the steps and the detail questions
 * added after the short ones. Read-only. */
export function OnboardingDetails() {
  return (
    <section className="panel section-pad ob-details" aria-labelledby="ob-details-title">
      <h2 id="ob-details-title">Pyetjet pas krijimit të biznesit</h2>
      <p className="muted-copy">
        Rendi i onboarding-ut: {ONBOARDING_STEPS.map((step, index) => `${index + 1}. ${step}`).join(" → ")}. Pyetjet më sipër bëhen te hapi 2.
        Këto më poshtë shtohen automatikisht sipas përgjigjeve: dalin te hapi 3, të plotësuara nga skanimi kur ka të dhëna, dhe te karta
        «Gati për klientët» në panel. Rregullat janë në kod dhe nuk fiken nga Cilësimet.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr><th scope="col">Pyetja</th><th scope="col">Kur bëhet</th><th scope="col">Ku ruhet përgjigjja</th></tr>
          </thead>
          <tbody>
            {DETAIL_QUESTIONS.map((question) => (
              <tr key={question.field}>
                <td><strong>{question.title}</strong></td>
                <td>{question.when}</td>
                <td>{question.savedTo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
