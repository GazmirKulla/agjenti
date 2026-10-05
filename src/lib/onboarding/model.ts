import {
  audioFields,
  detailFields,
  detailConflicts,
  parseDetails,
  parseAudioReview,
  pendingConfirmations,
  type BusinessDetails,
  type AudioReview,
} from "./audio-fields";
import {
  allowedCapabilities,
  allowedOfferings,
  allowedUseCases,
  buildBusinessProfile,
  capabilityChoices,
  offeringChoices,
  normalizeConditionalAnswers,
  useCaseChoices,
  type Choice,
} from "./rules";

const businessTypeOptions = [
  ["ecommerce", "Dyqan online", "products"],
  ["personalized", "Produkte të personalizuara", "spark"],
  ["fashion", "Veshje dhe modë", "products"],
  ["beauty", "Bukuri dhe kujdes", "spark"],
  ["electronics", "Elektronikë", "settings"],
  ["services", "Shërbime", "businesses"],
  ["other", "Tjetër", "dashboard"],
] as const;

export const questions = [
  {
    key: "businessType",
    label: "Lloji i biznesit",
    title: "Çfarë lloj biznesi ke?",
    description: "Do ta përshtatim hapësirën me mënyrën si punon.",
    options: businessTypeOptions,
  },
  {
    key: "useCases",
    label: "Qëllimet",
    title: "Për çfarë do ta përdorësh Agjentin?",
    description: "Mund të zgjedhësh disa mundësi.",
    options: useCaseChoices,
  },
  {
    key: "productCount",
    label: "Numri i produkteve ose shërbimeve",
    title: "Afërsisht sa produkte ose shërbime ofron?",
    description: "Një vlerësim mjafton. Mund ta ndryshosh më vonë.",
    optional: true,
    options: [
      ["0", "Sapo po filloj", "products"],
      ["1-10", "1–10", "products"],
      ["11-50", "11–50", "products"],
      ["51-200", "51–200", "products"],
      ["200+", "Mbi 200", "products"],
    ],
  },
  {
    key: "productType",
    label: "Lloji i ofertës",
    title: "Çfarë ofron biznesi yt?",
    description:
      "Zgjidh të gjitha format që përdor. Opsionet përshtaten sipas biznesit.",
    options: offeringChoices,
  },
  {
    key: "aiMode",
    label: "Aftësitë e Agjentit AI",
    title: "Çfarë dëshiron të bëjë Agjenti?",
    description:
      "Sugjerimet krijohen nga qëllimet që zgjodhe. Mund t’i ndryshosh më vonë.",
    optional: true,
    options: capabilityChoices,
  },
  {
    key: "messageVolume",
    label: "Vëllimi i mesazheve",
    title: "Sa mesazhe merr afërsisht në muaj?",
    description: "Do të sugjerojmë mënyrën e organizimit të Inbox-it.",
    optional: true,
    options: [
      ["under100", "Më pak se 100", "inbox"],
      ["100-500", "100–500", "inbox"],
      ["501-2000", "501–2,000", "inbox"],
      ["2000+", "Mbi 2,000", "inbox"],
    ],
  },
  {
    key: "teamSize",
    label: "Madhësia e ekipit",
    title: "Sa persona do ta përdorin Agjentin?",
    description: "Nuk vendosim kufizime funksionesh sipas madhësisë së ekipit.",
    optional: true,
    options: [
      ["solo", "Vetëm unë", "customers"],
      ["2-5", "2–5 persona", "customers"],
      ["6-20", "6–20 persona", "customers"],
      ["20+", "Mbi 20 persona", "customers"],
    ],
  },
] as const;

export type AnswerKey = (typeof questions)[number]["key"];
export type OnboardingQuestion = {
  key: AnswerKey;
  label: string;
  title: string;
  description: string;
  options: readonly Choice[];
  optional?: boolean;
};
export const allQuestionKeys = questions.map((q) => q.key) as AnswerKey[];
const wizardOrder: AnswerKey[] = [
  "businessType",
  "productType",
  "useCases",
  "aiMode",
  "productCount",
  "messageVolume",
  "teamSize",
];
export type Answers = {
  name: string;
  missingInformation?: string[];
  details?: BusinessDetails;
  audioReview?: AudioReview;
  confirmedProfile?: ReturnType<typeof buildBusinessProfile> & {
    details?: BusinessDetails;
  };
  businessType: string;
  useCases: string[];
  selectedUseCases: string[];
  productCount: string;
  productType: string;
  offeringTypes: string[];
  aiMode: string;
  agentCapabilities: string[];
  messageVolume: string;
  teamSize: string;
  businessProfile: ReturnType<typeof buildBusinessProfile> | null;
};
export const emptyAnswers: Answers = {
  name: "",
  businessType: "",
  useCases: [],
  selectedUseCases: [],
  productCount: "",
  productType: "",
  offeringTypes: [],
  aiMode: "",
  agentCapabilities: [],
  messageVolume: "",
  teamSize: "",
  businessProfile: null,
};

export function normalizeOnboardingSteps(input: unknown): AnswerKey[] {
  if (!Array.isArray(input)) return [...allQuestionKeys];
  const allowed = new Set<string>(allQuestionKeys);
  const seen = new Set<AnswerKey>();
  const result: AnswerKey[] = [];
  for (const value of input) {
    if (typeof value !== "string" || !allowed.has(value)) continue;
    const key = value as AnswerKey;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

export function activeQuestions(
  enabled: readonly AnswerKey[],
  answers: Answers = emptyAnswers,
): OnboardingQuestion[] {
  const set = new Set(enabled);
  const conditional = normalizeConditionalAnswers(answers);
  return wizardOrder
    .map((key) => questions.find((question) => question.key === key)!)
    .filter((q) => set.has(q.key))
    .filter((q) => q.key !== "aiMode" || conditional.useCases.length > 0)
    .map((question) => {
      let options: readonly Choice[] = question.options;
      if (question.key === "productType")
        options = allowedOfferings(answers.businessType);
      if (question.key === "useCases")
        options = allowedUseCases(
          answers.businessType,
          conditional.offeringTypes,
        );
      if (question.key === "aiMode")
        options = allowedCapabilities(
          answers.businessType,
          answers.offeringTypes,
          conditional.useCases,
        );
      const title =
        question.key === "productCount" &&
        answers.businessType === "services" &&
        answers.offeringTypes.length === 1 &&
        answers.offeringTypes[0] === "services"
          ? "Afërsisht sa shërbime ofron?"
          : question.title;
      return { ...question, title, options } as OnboardingQuestion;
    });
}

export function resumeWizardStep(
  storedStep: number,
  active: readonly OnboardingQuestion[],
): number {
  if (!Number.isInteger(storedStep) || storedStep <= 0 || !active.length)
    return 0;
  const key = questions[storedStep - 1]?.key;
  if (key) {
    const idx = active.findIndex((q) => q.key === key);
    if (idx >= 0) return idx + 1;
    for (let i = storedStep - 1; i < questions.length; i++) {
      const next = active.findIndex((q) => q.key === questions[i].key);
      if (next >= 0) return next + 1;
    }
    return active.length;
  }
  return Math.min(storedStep, active.length);
}

export function wizardStepToStored(
  wizardStep: number,
  active: readonly OnboardingQuestion[],
): number {
  if (wizardStep <= 0 || !active.length) return 0;
  const question = active[wizardStep - 1];
  if (!question) return questions.length;
  return questions.findIndex((q) => q.key === question.key) + 1;
}

function legacyCapabilities(mode: unknown): string[] {
  if (typeof mode !== "string") return [];
  const map: Record<string, string[]> = {
    review: ["handoff"],
    support: ["answer_questions", "ask_missing"],
    sales: ["understand_needs", "recommend_products"],
    collect: ["collect_order_details"],
    workflow: ["follow_workflow", "create_order"],
  };
  return map[mode] ?? [];
}

export function parseAnswers(
  input: unknown,
  complete = false,
  enabledSteps: readonly AnswerKey[] = allQuestionKeys,
): Answers {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Përgjigjet nuk janë të vlefshme.");
  const raw = input as Record<string, unknown>;
  if (typeof raw.name !== "string" || raw.name.trim().length > 100)
    throw new Error("Emri i biznesit duhet të ketë deri në 100 karaktere.");
  const name = raw.name.trim();
  if (complete && name.length < 2)
    throw new Error("Vendos emrin e biznesit (të paktën 2 karaktere).");

  const required = new Set(normalizeOnboardingSteps(enabledSteps));
  const allowedTypes = new Set<string>(
    businessTypeOptions.map(([value]) => value),
  );
  const businessType =
    typeof raw.businessType === "string" && allowedTypes.has(raw.businessType)
      ? raw.businessType
      : "";
  if (complete && required.has("businessType") && !businessType)
    throw new Error("Zgjidh llojin e biznesit.");

  const offeringInput = Array.isArray(raw.offeringTypes)
    ? raw.offeringTypes
    : raw.productType
      ? [raw.productType]
      : [];
  if (offeringInput.some((value) => typeof value !== "string"))
    throw new Error("Zgjidh lloje oferte të vlefshme.");
  const offeringAllow = new Set(
    allowedOfferings(businessType || "other").map(([value]) => value),
  );
  if ((offeringInput as string[]).some((value) => !offeringAllow.has(value)))
    throw new Error("Zgjidh vetëm ofertat që vlejnë për llojin e biznesit.");
  let offeringTypes = [
    ...new Set(
      (offeringInput as string[]).filter((value) => offeringAllow.has(value)),
    ),
  ];
  const serviceMode = offeringTypes.findLast((value) =>
    ["services", "mixed"].includes(value),
  );
  if (serviceMode) offeringTypes = [serviceMode];

  const caseInput = raw.useCases ?? raw.selectedUseCases ?? [];
  if (
    !Array.isArray(caseInput) ||
    caseInput.some((value) => typeof value !== "string")
  )
    throw new Error("Zgjidh qëllime të vlefshme.");
  const caseAllow = new Set(
    allowedUseCases(businessType || "other", offeringTypes).map(
      ([value]) => value,
    ),
  );
  if ((caseInput as string[]).some((value) => !caseAllow.has(value)))
    throw new Error("Zgjidh vetëm qëllimet që vlejnë për ofertën tënde.");
  const useCases = [
    ...new Set((caseInput as string[]).filter((value) => caseAllow.has(value))),
  ];
  if (complete && required.has("useCases") && useCases.length === 0)
    throw new Error(
      "Zgjidh të paktën një qëllim të vlefshëm për biznesin tënd.",
    );

  const capabilityInput = Array.isArray(raw.agentCapabilities)
    ? raw.agentCapabilities
    : legacyCapabilities(raw.aiMode);
  if (capabilityInput.some((value) => typeof value !== "string"))
    throw new Error("Zgjidh aftësi të vlefshme për Agjentin.");
  const knownCapabilities = new Set(capabilityChoices.map(([value]) => value));
  if (
    (capabilityInput as string[]).some((value) => !knownCapabilities.has(value))
  )
    throw new Error("Zgjidh aftësi të vlefshme për Agjentin.");
  const capabilityAllow = new Set(
    allowedCapabilities(businessType || "other", offeringTypes, useCases).map(
      ([value]) => value,
    ),
  );
  const agentCapabilities = [
    ...new Set(
      (capabilityInput as string[]).filter((value) =>
        capabilityAllow.has(value),
      ),
    ),
  ];

  const scalarValues: Record<
    "productCount" | "messageVolume" | "teamSize",
    string
  > = {
    productCount: "",
    messageVolume: "",
    teamSize: "",
  };
  for (const key of Object.keys(
    scalarValues,
  ) as (keyof typeof scalarValues)[]) {
    const question = questions.find(
      (item) => item.key === key,
    )! as OnboardingQuestion;
    const value = raw[key];
    const allowed = question.options.map(([choice]) => choice);
    if (value == null || value === "") {
      if (complete && required.has(key) && !question.optional)
        throw new Error(`Plotëso fushën: ${question.label}.`);
      continue;
    }
    if (typeof value !== "string" || !allowed.includes(value))
      throw new Error(`Plotëso fushën: ${question.label}.`);
    scalarValues[key] = value;
  }
  if (complete && required.has("productType") && offeringTypes.length === 0)
    throw new Error("Zgjidh të paktën një lloj oferte.");
  if (
    complete &&
    required.has("aiMode") &&
    !questions.find((q) => q.key === "aiMode")?.optional &&
    agentCapabilities.length === 0
  )
    throw new Error("Zgjidh aftësitë e Agjentit.");

  const normalized = normalizeConditionalAnswers({
    ...emptyAnswers,
    name,
    businessType,
    offeringTypes,
    productType: offeringTypes[0] ?? "",
    useCases,
    selectedUseCases: [...useCases],
    agentCapabilities,
    aiMode: agentCapabilities[0] ?? "",
    ...scalarValues,
  });
  normalized.selectedUseCases = [...normalized.useCases];
  normalized.productType = normalized.offeringTypes[0] ?? "";
  normalized.aiMode = normalized.agentCapabilities[0] ?? "";
  if (raw.details) normalized.details = parseDetails(raw.details);
  const audioReview = parseAudioReview(raw.audioReview);
  if (audioReview) {
    normalized.audioReview = audioReview;
    normalized.missingInformation = audioFields.filter((key) => {
      const value =
        key in detailFields
          ? normalized.details?.[key as keyof BusinessDetails]
          : (normalized as unknown as Record<string, unknown>)[key];
      return (
        value == null || value === "" || (Array.isArray(value) && !value.length)
      );
    });
    if (
      complete &&
      (!audioReview.reviewed || pendingConfirmations(audioReview).length)
    )
      throw new Error(
        "Rishiko dhe konfirmo të dhënat e sugjeruara para krijimit të hapësirës.",
      );
  }
  if (complete && detailConflicts(normalized).length)
    throw new Error(detailConflicts(normalized)[0].message);
  normalized.businessProfile = buildBusinessProfile(normalized);
  if (complete && audioReview)
    normalized.confirmedProfile = {
      ...normalized.businessProfile,
      details: normalized.details,
    };
  return normalized;
}

export function answerLabel(key: AnswerKey, value: string) {
  const options: readonly Choice[] =
    key === "productType"
      ? offeringChoices
      : key === "useCases"
        ? useCaseChoices
        : key === "aiMode"
          ? capabilityChoices
          : (questions.find((q) => q.key === key)?.options ?? []);
  return options.find((option) => option[0] === value)?.[1] || value;
}

export function initialInstructions(a: Answers) {
  const business =
    answerLabel("businessType", a.businessType) || "e përgjithshme";
  const capabilities = (
    a.agentCapabilities.length
      ? a.agentCapabilities
      : (a.businessProfile?.recommendedConfiguration.capabilities ?? [])
  )
    .map((key) => answerLabel("aiMode", key).toLocaleLowerCase())
    .join(", ");
  const offer = a.offeringTypes
    .map((key) => answerLabel("productType", key))
    .join(", ");
  const goals = (
    a.useCases.length
      ? a.useCases
      : (a.businessProfile?.recommendedConfiguration.useCases ?? [])
  )
    .map((key) => answerLabel("useCases", key))
    .join(", ");
  return [
    `Je asistenti i biznesit ${a.name}. Fusha: ${business}.`,
    "Përgjigju në shqip ose në gjuhën e klientit, me ton miqësor dhe profesional. Mos shpik çmime, stok ose politika. Përdor katalogun dhe njohuritë e biznesit. Nëse informacioni mungon, kërko ndihmën e stafit.",
    a.details?.businessDescription
      ? `Përshkrimi i konfirmuar i biznesit: ${a.details.businessDescription}`
      : "",
    offer ? `Oferta e biznesit: ${offer}.` : "",
    goals ? `Qëllimet e Agjentit: ${goals}.` : "",
    capabilities ? `Aftësitë e kërkuara: ${capabilities}.` : "",
    a.offeringTypes.some((item) =>
      ["photo", "text", "personalized"].includes(item),
    )
      ? "Për personalizimet kërko dhe përcjell të dhënat që kërkon workflow, si foto, tekst ose variante; mos premto veprime të pakonfirmuara."
      : "Kërko sqarime për zgjedhjet e produktit ose shërbimit kur nevojiten.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function recommendations(a: Answers) {
  const hasProducts = a.offeringTypes.some((item) => item !== "services");
  return [
    a.productCount === "0"
      ? `Fillo duke shtuar ${hasProducts ? "një produkt" : "një shërbim"}; katalogun mund ta zgjerosh gradualisht.`
      : ["51-200", "200+"].includes(a.productCount)
        ? "Organizo katalogun sipas llojeve dhe shqyrto lidhjen e një katalogu të jashtëm te Cilësimet."
        : `Shto fillimisht ${hasProducts ? "produktet" : "shërbimet"} që kërkohen më shpesh.`,
    a.offeringTypes.includes("photo") ||
    a.offeringTypes.includes("text") ||
    a.offeringTypes.includes("personalized")
      ? "Përdor workflow-t për të mbledhur personalizimet dhe për të kërkuar miratim."
      : a.offeringTypes.includes("services") && !hasProducts
        ? "Shto kushtet dhe mënyrën e rezervimit te Njohuria e biznesit."
        : a.offeringTypes.includes("variants")
          ? "Përshkruaj masat, ngjyrat ose variantet në katalog dhe përshtat workflow-n për porositë."
          : "Plotëso përshkrimet dhe çmimet përpara se të aktivizosh përgjigjet automatike.",
    a.agentCapabilities.includes("handoff")
      ? "Rishiko si dhe kur bisedat duhet t’i kalojnë stafit."
      : "Rishiko udhëzimet, testo agjentin dhe vendos vetë nëse do të aktivizosh përgjigjet automatike.",
    ["501-2000", "2000+"].includes(a.messageVolume)
      ? "Për vëllimin tënd të mesazheve, përdor statuset e bisedave për të ndjekur rastet që kërkojnë staf."
      : "Kontrollo bisedat e para në Inbox për të përmirësuar përgjigjet dhe njohuritë.",
    a.teamSize === "solo"
      ? "Inbox-i dhe porositë janë të gjitha në hapësirën tënde."
      : "Mund të shtosh anëtarë të ekipit më vonë nga menaxhimi i biznesit.",
  ];
}
