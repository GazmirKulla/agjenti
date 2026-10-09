import { allQuestionKeys, type AnswerKey, type Answers } from "./model";
import { clarifications, fieldValue, hasValue } from "./audio-model";
import { businessProfiles, type BusinessType } from "./rules";

export type AudioGuideQuestion = { id: string; title: string; hint: string };

const categoryGuides: Record<BusinessType, { offering: string; process: string }> = {
  ecommerce: {
    offering: "Përmend produktet kryesore dhe nëse kanë variante ose personalizim.",
    process: "Si zgjedh klienti produktin, si porosit dhe si funksionojnë pagesa, dërgesa e kthimet?",
  },
  personalized: {
    offering: "Çfarë personalizon: foto, tekst, madhësi apo dizajn?",
    process: "Çfarë duhet të dërgojë klienti? A miratohet dizajni dhe sa zgjat përgatitja?",
  },
  fashion: {
    offering: "Çfarë veshjesh ofron dhe si zgjedh klienti masën, ngjyrën ose modelin?",
    process: "Si kontrolloni masën dhe disponueshmërinë? Si funksionojnë dërgesat dhe ndërrimet?",
  },
  beauty: {
    offering: "Ofron trajtime, produkte apo të dyja? Përmend më të kërkuarat.",
    process: "Nëse ofron trajtime, si caktohet takimi? Nëse shet produkte, si bëhet porosia?",
  },
  electronics: {
    offering: "Çfarë pajisjesh ose aksesorësh shet? Cilat modele dhe specifika kanë rëndësi?",
    process: "Si kontrolloni modelin dhe përputhshmërinë? Si funksionojnë porosia, dërgesa dhe garancia?",
  },
  services: {
    offering: "Çfarë shërbimesh ofron dhe për kë? Përmend nëse shet edhe produkte.",
    process: "Çfarë informacioni kërkon paraprakisht? Si caktoni orarin ose përgatitni ofertën?",
  },
  other: {
    offering: "Shpjego çfarë bën biznesi, për kë dhe çfarë produktesh ose shërbimesh ofron.",
    process: "Nga kontakti i parë deri te marrja e produktit ose shërbimit, cilët janë hapat?",
  },
};

export function initialOnboardingMode(answers: Answers, storedStep: number) {
  // Review always remains reachable for recordings made before the guided flow.
  if (answers.audioReview) {
    return answers.guidedOnboardingMode ?? "review";
  }
  if (answers.guidedOnboardingMode)
    return answers.guidedOnboardingMode;
  return storedStep > 0 ? "manual" : "basics";
}

export function audioGuide(
  answers: Answers,
  enabledSteps: readonly AnswerKey[] = allQuestionKeys,
): AudioGuideQuestion[] {
  const category = Object.hasOwn(businessProfiles, answers.businessType)
    ? answers.businessType as BusinessType
    : "other";
  const guide = categoryGuides[category];
  const booking = answers.useCases.includes("booking");
  const orders = answers.useCases.includes("orders");
  const leads = answers.useCases.includes("leads");
  const core: AudioGuideQuestion[] = [
    { id: "offeringsSummary", title: "Çfarë ofron biznesi yt?", hint: guide.offering },
    {
      id: "customerQuestions",
      title: "Çfarë të pyesin më shpesh klientët?",
      hint: "Jep një ose dy shembuj dhe përgjigjen që u jep zakonisht.",
    },
    {
      id: "customerProcess",
      title: booking && orders
        ? "Si funksionojnë porositë dhe rezervimet?"
        : booking ? "Si funksionon një rezervim ose takim?"
        : orders ? "Si funksionon një porosi?"
        : leads ? "Si e trajton një kërkesë nga një klient i interesuar?"
        : "Si e merr klienti produktin ose shërbimin?",
      hint: guide.process,
    },
    {
      id: "handoffRules",
      title: "Çfarë dëshiron të bëjë Agjenti dhe kur të të kërkojë ndihmë?",
      hint: "Përmend çfarë mund të trajtojë vetë dhe çfarë kërkon gjithmonë konfirmimin tënd.",
    },
  ];
  if (!answers.audioReview) return core;
  const followups = clarifications(answers, [...enabledSteps]).map((item) => ({
    id: item.field, title: item.message,
    hint: "Saktëso vetëm këtë informacion; përgjigjet e tjera ruhen.",
  }));
  for (const question of core) {
    if (!hasValue(fieldValue(answers, question.id))) followups.push(question);
  }
  // Low-confidence facts are confirmed in the review form, not by assuming
  // another recording will prove or override them.
  return followups.length ? followups.filter((q, index, all) =>
    all.findIndex((other) => other.id === q.id) === index,
  ) : [{
    id: "supplement",
    title: "Çfarë dëshiron të shtosh ose të sqarosh?",
    hint: "Përmend vetëm informacionin e ri. Korrigjimet manuale ruhen; mund t’i ndryshosh te profili.",
  }];
}
