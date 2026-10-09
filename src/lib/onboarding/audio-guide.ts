import { allQuestionKeys, type AnswerKey, type Answers } from "./model";
import { detailFields, pendingConfirmations } from "./audio-fields";
import { clarifications, fieldValue, hasValue } from "./audio-model";
import { businessProfiles, offerMode, type BusinessType } from "./rules";

export type AudioGuideQuestion = { id: string; title: string; hint: string };

const categoryGuides: Record<BusinessType, { offering: string; process: string }> = {
  ecommerce: {
    offering: "Përmend produktet kryesore dhe shërbimet që ofron, nëse ka.",
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
    offering: "Çfarë pajisjesh, aksesorësh ose riparimesh ofron?",
    process: "Si kontrolloni modelin dhe përputhshmërinë? Si funksionojnë porosia, dërgesa dhe garancia?",
  },
  services: {
    offering: "Çfarë shërbimesh ofron dhe për kë? Përmend nëse shet edhe produkte.",
    process: "Çfarë informacioni kërkon paraprakisht? Si caktoni orarin ose përgatitni ofertën?",
  },
  retail: {
    offering: "Çfarë shet? Përmend edhe shërbimet që ofron, nëse ka.",
    process: "Si porosit klienti dhe si e merr produktin ose shërbimin?",
  },
  healthcare: {
    offering: "Çfarë konsultash, trajtimesh ose produktesh ofron?",
    process: "Si kërkohet një takim dhe kush e konfirmon?",
  },
  food: {
    offering: "Çfarë ofron: ushqim, pije, porosi apo shërbime të tjera?",
    process: "Si bëhet porosia ose rezervimi i tavolinës?",
  },
  hospitality: {
    offering: "Çfarë akomodimi dhe shërbimesh ofron?",
    process: "Si kërkohet dhe konfirmohet qëndrimi ose shërbimi?",
  },
  fitness: {
    offering: "Çfarë seancash, abonimesh ose produktesh ofron?",
    process: "Si regjistrohet klienti ose cakton një seancë?",
  },
  education: {
    offering: "Çfarë kursesh, konsultash ose materialesh digjitale ofron?",
    process: "Si regjistrohet klienti dhe si merr kursin ose materialin?",
  },
  professional: {
    offering: "Çfarë pune ose konsulence ofron dhe për kë?",
    process: "Si merr kërkesën dhe përgatit një ofertë ose takim?",
  },
  digital: {
    offering: "Çfarë bën platforma ose shërbimi online, kujt i shërben dhe çfarë planesh ose abonimesh ofron?",
    process: "Si regjistrohet klienti, zgjedh planin dhe fillon ta përdorë platformën ose shërbimin?",
  },
  technical: {
    offering: "Çfarë ndërhyrjesh, riparimesh ose pjesësh ofron?",
    process: "Çfarë kërkon për të vlerësuar problemin dhe konfirmuar ndërhyrjen?",
  },
  realestate: {
    offering: "Çfarë pronash dhe shërbimesh ofron?",
    process: "Si e kupton kërkesën dhe organizon një vizitë ose konsultë?",
  },
  manufacturing: {
    offering: "Çfarë prodhon ose shpërndan dhe për kë?",
    process: "Si trajton kërkesën për ofertë ose porosi?",
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
  const mode = offerMode(answers.offeringTypes);
  const booking = answers.useCases.includes("booking");
  const orders = answers.useCases.includes("orders");
  const leads = answers.useCases.includes("leads");
  const categoryContext = answers.businessType === "other" ? answers.details?.categoryDescription : null;
  const catalogs: AudioGuideQuestion = {
    id: "catalogContext", title: "Si i përdor klienti katalogët e tu?",
    hint: "Shpjego si organizohen dhe si gjendet oferta e duhur. Mund t’i shtosh më vonë.",
  };
  const offerTitle = mode === "standard" ? "Cilat produkte shet?"
    : mode === "services" ? "Cilat shërbime ofron?"
    : mode === "mixed" ? "Cilat produkte dhe shërbime ofron?" : "Çfarë ofron biznesi yt?";
  const offeringHint = mode === "standard"
    ? "Përmend produktet kryesore. Nëse kanë variante ose personalizim, shpjego si zgjidhen."
    : mode === "services"
      ? category === "digital" ? guide.offering
        : "Përmend shërbimet kryesore dhe kujt i shërbejnë."
      : guide.offering;
  const serviceSectors = ["beauty", "healthcare", "hospitality", "fitness", "education", "professional", "digital", "technical", "realestate", "services"];
  const processHint = mode === "standard"
    ? category === "digital" ? "Si porosit klienti, si paguan dhe si merr akses te produkti digjital?"
      : "Si zgjedh dhe porosit klienti? Si funksionojnë pagesa, dorëzimi dhe kthimet?"
    : mode === "services" && !serviceSectors.includes(category)
      ? "Si kërkohet shërbimi, si përcaktohen çmimi dhe koha, dhe kush e konfirmon?"
      : guide.process;
  const core: AudioGuideQuestion[] = [
    { id: "offeringsSummary", title: offerTitle, hint: categoryContext ? `${categoryContext}: ${offeringHint}` : offeringHint },
    {
      id: "customerQuestions",
      title: "Çfarë të pyesin më shpesh klientët?",
      hint: category === "digital"
        ? "Për çfarë kërkojnë ndihmë klientët: përdorimin, planet, pagesat apo probleme teknike? Jep shembuj dhe përgjigjet që u jep."
        : "Jep një ose dy shembuj dhe përgjigjen që u jep zakonisht.",
    },
    {
      id: "customerProcess",
      title: booking && orders
        ? "Si funksionojnë porositë dhe rezervimet?"
        : booking ? "Si funksionon një rezervim ose takim?"
        : orders ? "Si funksionon një porosi?"
        : leads ? "Si e trajton një kërkesë nga një klient i interesuar?"
        : mode === "standard" ? "Si porosit dhe e merr produktin klienti?"
        : mode === "services" ? "Si kërkon dhe e merr shërbimin klienti?"
        : "Si e merr klienti produktin ose shërbimin?",
      hint: `${processHint}${mode === "mixed" ? " Dallo hapat për produktet nga hapat për shërbimet." : ""}${needsCatalogContext(answers) ? " Si gjendet oferta në katalogët e tu?" : ""}`,
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
  if (needsCatalogContext(answers) && !hasValue(answers.details?.catalogContext)) followups.push(catalogs);
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

export function needsCatalogContext(answers: Answers) {
  const text = [answers.details?.categoryDescription, answers.details?.businessDescription,
    ...(answers.details?.offeringsSummary ?? []), answers.details?.customerProcess].join(" ");
  return /(?:disa|shumë|shume|multiple|several|[2-9])\s+(?:katalog|catalog)|katalog[\wë]*\s+(?:të ndrysh|te ndrysh|të shum|te shum)/i.test(text);
}

/** Only expose details that add information to the selected sector and offer. */
export function reviewDetailFields(answers: Answers) {
  const mode = offerMode(answers.offeringTypes);
  const pending = new Set(answers.audioReview ? pendingConfirmations(answers.audioReview) : []);
  return Object.entries(detailFields).filter(([field]) => {
    if (field === "offeringsSummary") return false;
    // Previously saved uncertainty must remain reachable for confirmation.
    if (pending.has(field)) return true;
    if (field === "businessCategory") return !answers.businessType;
    if (field === "categoryDescription") return answers.businessType === "other";
    if (field === "businessDescription") return hasValue(fieldValue(answers, field));
    if (field === "catalogContext") return needsCatalogContext(answers) || hasValue(fieldValue(answers, field));
    if (field === "sellsProducts") return clarifications(answers).some(q => q.field === "offeringTypes" && q.message.includes("nuk përputhen"));
    if (field === "hasVariants" || field === "isPersonalized") {
      if (!mode || mode === "services") return false;
      return answers.businessType !== "digital" || hasValue(fieldValue(answers, field));
    }
    return true;
  });
}
