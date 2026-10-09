import type { BusinessDetails } from "./audio-fields";
import { supportedBusinessCategories, type BusinessType } from "./categories";
export type { BusinessType } from "./categories";
export type Choice = readonly [value: string, label: string, icon: string];

export const offeringChoices: readonly Choice[] = [
  ["standard", "Produkte standarde", "products"],
  ["variants", "Produkte me masa, ngjyra ose variante", "dashboard"],
  ["personalized", "Produkte të personalizuara", "spark"],
  ["photo", "Personalizim me foto", "customers"],
  ["text", "Personalizim me tekst", "inbox"],
  ["services", "Vetëm shërbime", "settings"],
  ["mixed", "Shërbime dhe produkte", "businesses"],
];

// The offer mode is chosen once; variants and personalization are product details.
export const offerModeChoices: readonly Choice[] = [
  ["standard", "Produkte", "products"],
  ["services", "Shërbime", "settings"],
  ["mixed", "Produkte dhe shërbime", "businesses"],
];
export function offerMode(offerings: readonly string[]) {
  if (offerings.includes("mixed")) return "mixed";
  if (offerings.includes("services")) return "services";
  return offerings.length ? "standard" : "";
}

export const useCaseChoices: readonly Choice[] = [
  ["support", "T’u përgjigjet klientëve", "inbox"],
  ["sales", "T’i ndihmojë klientët të zgjedhin", "spark"],
  ["orders", "Të ndihmojë klientin të përfundojë porosinë", "orders"],
  ["booking", "Të marrë kërkesa për rezervime", "calendar"],
  ["leads", "Të mbledhë kontaktet e klientëve", "customers"],
];
export const useCaseDescriptions: Record<string, string> = {
  support: "Për ofertën, çmimet, përdorimin dhe politikat e biznesit.",
  sales: "Kupton nevojat dhe ndihmon në zgjedhjen e ofertës së duhur.",
  orders: "E udhëzon klientin deri te përgatitja e porosisë për konfirmim.",
  booking: "Mbledh shërbimin, orarin e dëshiruar dhe kontaktin për konfirmim.",
  leads: "Ruan interesin dhe kontaktin e klientit për ndjekje ose ofertë.",
};
// Keep historical IDs valid in saved profiles, without exposing duplicate goals.
export const supportedUseCaseChoices: readonly Choice[] = [
  ...useCaseChoices,
  ["messages", "Menaxhim mesazhesh në Instagram", "instagram"],
  ["products", "Menaxhim produktesh", "products"],
  ["customers", "Menaxhim klientësh", "customers"],
  ["recommendations", "Rekomandime produktesh", "agents"],
  ["collection", "Mbledhje të dhënash për porosi", "workflows"],
];
export function canonicalUseCases(values: readonly string[]) {
  const aliases: Record<string, string> = {
    messages: "support", products: "sales", customers: "leads",
    recommendations: "sales", collection: "orders",
  };
  return [...new Set(values.map(value => aliases[value] ?? value))];
}
export function visibleUseCases(businessType: string, offerings: readonly string[], selected: readonly string[]) {
  const allowed = new Set(allowedUseCases(businessType, offerings).map(([id]) => id));
  const mode = offerMode(offerings);
  return useCaseChoices.filter(([id]) => allowed.has(id) &&
    (id !== "booking" || mode === "services" || mode === "mixed" || selected.includes("booking")));
}

export const capabilityChoices: readonly Choice[] = [
  ["reply_messages", "Përgjigjet mesazheve në Instagram", "instagram"],
  ["answer_questions", "Përgjigjet pyetjeve të zakonshme", "inbox"],
  ["ask_missing", "Kërkon informacionin që mungon", "customers"],
  ["handoff", "Ia kalon stafit rastet e nevojshme", "businesses"],
  ["qualify_leads", "Kualifikon kërkesat e klientëve", "customers"],
  ["handle_bookings", "Mbledh detajet e kërkesave dhe rezervimeve", "orders"],
  ["understand_needs", "Kupton nevojat para se të sugjerojë", "spark"],
  ["recommend_products", "Rekomandon produkte nga katalogu", "products"],
  ["compare_products", "Krahason produkte dhe variante", "dashboard"],
  [
    "answer_product_details",
    "Përdor detajet e katalogut në përgjigje",
    "products",
  ],
  ["collect_order_details", "Mbledh të dhënat e porosisë", "orders"],
  ["follow_workflow", "Ndjek hapat e workflow-t", "workflows"],
  ["create_order", "Përgatit porosinë për konfirmim", "orders"],
  [
    "recognize_customers",
    "Përdor kontekstin e klientëve ekzistues",
    "customers",
  ],
  [
    "save_customer_details",
    "Ruajnë të dhënat e nevojshme të klientit",
    "customers",
  ],
];

const productUseCases = [
  "products",
  "orders",
  "recommendations",
  "collection",
] as const;

const commonCapabilities = [
  "reply_messages",
  "answer_questions",
  "ask_missing",
  "handoff",
  "recognize_customers",
  "save_customer_details",
] as const;
const productCapabilities = [
  "recommend_products",
  "compare_products",
  "answer_product_details",
  "collect_order_details",
  "follow_workflow",
  "create_order",
] as const;

/** Qëllim → aftësi të sugjeruara që shfaqen te hapi aiMode. */
export const useCaseCapabilities: Record<string, readonly string[]> = {
  messages: ["reply_messages", "handoff"],
  support: ["reply_messages", "answer_questions", "answer_product_details", "ask_missing", "handoff"],
  leads: ["ask_missing", "qualify_leads", "save_customer_details", "handoff"],
  booking: ["ask_missing", "handle_bookings", "handoff"],
  sales: ["understand_needs", "recommend_products", "compare_products", "answer_product_details", "ask_missing", "handoff"],
  products: [
    "answer_product_details",
    "recommend_products",
    "compare_products",
  ],
  orders: [
    "ask_missing",
    "collect_order_details",
    "follow_workflow",
    "create_order",
    "handoff",
  ],
  customers: ["recognize_customers", "save_customer_details"],
  recommendations: [
    "understand_needs",
    "recommend_products",
    "compare_products",
  ],
  collection: [
    "ask_missing",
    "collect_order_details",
    "follow_workflow",
    "create_order",
  ],
};

type BusinessRule = {
  label: string;
  allowedOfferingTypes: string[];
  allowedUseCases: string[];
  allowedCapabilities: string[];
  recommendedDefaults: { useCases: string[]; capabilities: string[]; workflow: string };
};

// Categories guide the interview; offerings and goals determine capabilities.
export const businessProfiles = Object.fromEntries(
  supportedBusinessCategories.map(([id, label]) => [id, {
    label,
    allowedOfferingTypes: offeringChoices.map(([value]) => value),
    allowedUseCases: supportedUseCaseChoices.map(([value]) => value),
    allowedCapabilities: capabilityChoices.map(([value]) => value),
    recommendedDefaults: {
      useCases: ["support"],
      capabilities: [...commonCapabilities],
      workflow: "business-defined",
    },
  }]),
) as Record<BusinessType, BusinessRule>;

export function offeringDefaults(offerings: readonly string[]) {
  const products = offerings.some(value => value !== "services");
  const services = offerings.some(value => value === "services" || value === "mixed");
  const personalized = offerings.some(value => ["personalized", "photo", "text"].includes(value));
  return {
    useCases: ["support", ...(products ? ["sales", "orders"] : []), ...(services ? ["leads", "booking"] : [])],
    capabilities: ["reply_messages", "answer_questions", "ask_missing", "handoff", ...(products ? ["recommend_products", "collect_order_details"] : []), ...(services ? ["qualify_leads", "handle_bookings"] : [])],
    workflow: products && services ? "service-or-product-request"
      : personalized ? "personalized-order"
      : offerings.includes("variants") ? "variant-order"
      : products ? "product-orders"
      : services ? "service-request" : "business-defined",
  };
}

export type BusinessProfileAnswers = Partial<BusinessDetails> & {
  missingInformation?: string[];
  businessType: string;
  offeringTypes: string[];
  selectedUseCases: string[];
  agentCapabilities: string[];
  recommendedConfiguration: {
    useCases: readonly string[];
    capabilities: readonly string[];
    workflow: string;
    checklist: string[];
  };
};

function rulesFor(businessType: string) {
  return (
    businessProfiles[businessType as BusinessType] ?? businessProfiles.other
  );
}

export function allowedOfferings(businessType: string) {
  const allowed = new Set<string>(rulesFor(businessType).allowedOfferingTypes);
  return offeringChoices.filter(([value]) => allowed.has(value));
}

export function allowedUseCases(
  businessType: string,
  offerings: readonly string[],
) {
  const rules = rulesFor(businessType);
  const hasProducts = offerings.some((item) => item !== "services");
  const allowed = new Set<string>(rules.allowedUseCases);
  return supportedUseCaseChoices.filter(
    ([value]) =>
      allowed.has(value) &&
      (offerings.length === 0 || hasProducts ||
        !productUseCases.includes(value as (typeof productUseCases)[number])),
  );
}

export function allowedCapabilities(
  businessType: string,
  offerings: readonly string[],
  selectedUseCases: readonly string[],
) {
  const rules = rulesFor(businessType);
  const allowed = new Set<string>(rules.allowedCapabilities);
  const hasProducts = offerings.some((item) => item !== "services");
  const relevant = new Set(
    [...selectedUseCases, ...canonicalUseCases(selectedUseCases)]
      .flatMap((item) => useCaseCapabilities[item] ?? []),
  );
  return capabilityChoices.filter(
    ([value]) =>
      allowed.has(value) &&
      relevant.has(value) &&
      (hasProducts ||
        !productCapabilities.includes(
          value as (typeof productCapabilities)[number],
        )),
  );
}

export function normalizeConditionalAnswers<
  T extends {
    businessType: string;
    offeringTypes: string[];
    useCases: string[];
    agentCapabilities: string[];
  },
>(answers: T): T {
  const offerings = new Set(
    allowedOfferings(answers.businessType).map(([value]) => value),
  );
  let offeringTypes = answers.offeringTypes.filter((value) =>
    offerings.has(value),
  );
  const serviceMode = offeringTypes.findLast((value) =>
    ["services", "mixed"].includes(value),
  );
  if (serviceMode) offeringTypes = [serviceMode];
  const cases = new Set(
    allowedUseCases(answers.businessType, offeringTypes).map(
      ([value]) => value,
    ),
  );
  const useCases = answers.useCases.filter((value) => cases.has(value));
  const capabilities = new Set(
    allowedCapabilities(answers.businessType, offeringTypes, useCases).map(
      ([value]) => value,
    ),
  );
  const agentCapabilities = answers.agentCapabilities.filter((value) =>
    capabilities.has(value),
  );
  return { ...answers, offeringTypes, useCases, agentCapabilities };
}

export function buildBusinessProfile(answers: {
  missingInformation?: string[];
  details?: BusinessDetails;
  businessType: string;
  offeringTypes: string[];
  useCases: string[];
  agentCapabilities: string[];
  productCount: string;
  messageVolume: string;
  teamSize: string;
}): BusinessProfileAnswers {
  const defaults = offeringDefaults(answers.offeringTypes);
  const validCases = new Set(
    allowedUseCases(answers.businessType, answers.offeringTypes).map(
      ([value]) => value,
    ),
  );
  const recommendedCases = defaults.useCases.filter((value) =>
    validCases.has(value),
  );
  const validCaps = new Set(
    allowedCapabilities(
      answers.businessType,
      answers.offeringTypes,
      answers.useCases.length ? answers.useCases : recommendedCases,
    ).map(([value]) => value),
  );
  const checklist = [
    "Lidh Instagram-in",
    answers.offeringTypes.some((item) => item !== "services")
      ? "Shto produktet kryesore"
      : "Shto shërbimet kryesore",
    "Rishiko udhëzimet e Agjentit AI",
    "Përshtat workflow-t sipas ofertës",
    "Provo një bisedë para aktivizimit",
  ];
  return {
    ...answers.details,
    ...(answers.missingInformation
      ? { missingInformation: answers.missingInformation }
      : {}),
    businessType: answers.businessType || "other",
    offeringTypes: [...answers.offeringTypes],
    selectedUseCases: [...answers.useCases],
    agentCapabilities: [...answers.agentCapabilities],
    recommendedConfiguration: {
      useCases: recommendedCases,
      capabilities: answers.agentCapabilities.length
        ? [...answers.agentCapabilities]
        : defaults.capabilities.filter((value) => validCaps.has(value)),
      workflow: defaults.workflow,
      checklist,
    },
  };
}
