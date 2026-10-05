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

export const useCaseChoices: readonly Choice[] = [
  ["messages", "Menaxhim mesazhesh në Instagram", "instagram"],
  ["support", "Mbështetje për klientët", "inbox"],
  ["leads", "Mbledhje të dhënave për klientë të rinj", "customers"],
  ["booking", "Menaxhim kërkesash dhe rezervimesh", "orders"],
  ["sales", "Asistent shitjesh", "spark"],
  ["products", "Menaxhim produktesh", "products"],
  ["orders", "Menaxhim porosish", "orders"],
  ["customers", "Menaxhim klientësh", "customers"],
  ["recommendations", "Rekomandime produktesh", "agents"],
  ["collection", "Mbledhje të dhënash për porosi", "workflows"],
];

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
  "sales",
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
  "understand_needs",
  "recommend_products",
  "compare_products",
  "answer_product_details",
  "collect_order_details",
  "follow_workflow",
  "create_order",
] as const;
const serviceCapabilities = ["qualify_leads", "handle_bookings"] as const;

export const businessProfiles = {
  ecommerce: {
    label: "Dyqan online",
    allowedOfferingTypes: ["standard", "variants", "personalized"],
    allowedUseCases: [
      "messages",
      "support",
      "leads",
      ...productUseCases,
      "customers",
    ],
    allowedCapabilities: [
      ...commonCapabilities,
      ...productCapabilities,
      "qualify_leads",
    ],
    recommendedDefaults: {
      useCases: ["messages", "support", "sales", "orders"],
      capabilities: [
        "reply_messages",
        "answer_questions",
        "recommend_products",
        "collect_order_details",
      ],
      workflow: "product-orders",
    },
  },
  personalized: {
    label: "Produkte të personalizuara",
    allowedOfferingTypes: ["personalized", "photo", "text", "variants"],
    allowedUseCases: [
      "messages",
      "support",
      "leads",
      ...productUseCases,
      "customers",
    ],
    allowedCapabilities: [
      ...commonCapabilities,
      ...productCapabilities,
      "qualify_leads",
    ],
    recommendedDefaults: {
      useCases: ["messages", "support", "sales", "collection"],
      capabilities: [
        "reply_messages",
        "ask_missing",
        "recommend_products",
        "collect_order_details",
        "follow_workflow",
      ],
      workflow: "personalized-order",
    },
  },
  fashion: {
    label: "Veshje dhe modë",
    allowedOfferingTypes: ["standard", "variants", "personalized"],
    allowedUseCases: [
      "messages",
      "support",
      "leads",
      ...productUseCases,
      "customers",
    ],
    allowedCapabilities: [
      ...commonCapabilities,
      ...productCapabilities,
      "qualify_leads",
    ],
    recommendedDefaults: {
      useCases: ["messages", "sales", "recommendations", "orders"],
      capabilities: [
        "reply_messages",
        "understand_needs",
        "recommend_products",
        "compare_products",
        "collect_order_details",
      ],
      workflow: "variant-order",
    },
  },
  beauty: {
    label: "Bukuri dhe kujdes",
    allowedOfferingTypes: [
      "standard",
      "variants",
      "personalized",
      "services",
      "mixed",
    ],
    allowedUseCases: [
      "messages",
      "support",
      "leads",
      "booking",
      ...productUseCases,
      "customers",
    ],
    allowedCapabilities: [
      ...commonCapabilities,
      ...productCapabilities,
      ...serviceCapabilities,
    ],
    recommendedDefaults: {
      useCases: ["messages", "support", "booking", "recommendations"],
      capabilities: [
        "reply_messages",
        "answer_questions",
        "handle_bookings",
        "recommend_products",
      ],
      workflow: "service-or-product-request",
    },
  },
  electronics: {
    label: "Elektronikë",
    allowedOfferingTypes: ["standard", "variants", "personalized"],
    allowedUseCases: [
      "messages",
      "support",
      "leads",
      ...productUseCases,
      "customers",
    ],
    allowedCapabilities: [
      ...commonCapabilities,
      ...productCapabilities,
      "qualify_leads",
    ],
    recommendedDefaults: {
      useCases: ["messages", "support", "products", "orders"],
      capabilities: [
        "reply_messages",
        "answer_questions",
        "compare_products",
        "answer_product_details",
        "collect_order_details",
      ],
      workflow: "product-orders",
    },
  },
  services: {
    label: "Shërbime",
    allowedOfferingTypes: ["services", "mixed"],
    allowedUseCases: [
      "messages",
      "support",
      "leads",
      "booking",
      "customers",
      ...productUseCases,
    ],
    allowedCapabilities: [
      ...commonCapabilities,
      ...serviceCapabilities,
      ...productCapabilities,
    ],
    recommendedDefaults: {
      useCases: ["messages", "support", "leads", "booking"],
      capabilities: [
        "reply_messages",
        "answer_questions",
        "qualify_leads",
        "handle_bookings",
        "handoff",
      ],
      workflow: "service-request",
    },
  },
  other: {
    label: "Tjetër",
    allowedOfferingTypes: offeringChoices.map(([value]) => value),
    allowedUseCases: [
      "messages",
      "support",
      "leads",
      "booking",
      ...productUseCases,
      "customers",
    ],
    allowedCapabilities: [
      ...commonCapabilities,
      ...serviceCapabilities,
      ...productCapabilities,
    ],
    recommendedDefaults: {
      useCases: ["messages", "support"],
      capabilities: [
        "reply_messages",
        "answer_questions",
        "ask_missing",
        "handoff",
      ],
      workflow: "business-defined",
    },
  },
} as const;

export type BusinessType = keyof typeof businessProfiles;
export type BusinessProfileAnswers = {
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
  return useCaseChoices.filter(
    ([value]) =>
      allowed.has(value) &&
      (hasProducts ||
        !productUseCases.includes(value as (typeof productUseCases)[number])),
  );
}

export function allowedCapabilities(
  businessType: string,
  offerings: readonly string[],
  selectedUseCases: readonly string[],
) {
  const rules = rulesFor(businessType);
  const selected = new Set(selectedUseCases);
  const allowed = new Set<string>(rules.allowedCapabilities);
  const hasProducts = offerings.some((item) => item !== "services");
  const useCaseCapabilities: Record<string, readonly string[]> = {
    messages: ["reply_messages", "handoff"],
    support: ["answer_questions", "ask_missing", "handoff"],
    leads: ["ask_missing", "qualify_leads", "save_customer_details", "handoff"],
    booking: ["ask_missing", "handle_bookings", "handoff"],
    sales: ["understand_needs", "recommend_products", "compare_products"],
    products: [
      "answer_product_details",
      "recommend_products",
      "compare_products",
    ],
    orders: [
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
  const relevant = new Set(
    selectedUseCases.flatMap((item) => useCaseCapabilities[item] ?? []),
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
  const offeringTypes = answers.offeringTypes.filter((value) =>
    offerings.has(value),
  );
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
  businessType: string;
  offeringTypes: string[];
  useCases: string[];
  agentCapabilities: string[];
  productCount: string;
  messageVolume: string;
  teamSize: string;
}): BusinessProfileAnswers {
  const defaults = rulesFor(answers.businessType).recommendedDefaults;
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
    businessType: answers.businessType || "other",
    offeringTypes: [...answers.offeringTypes],
    selectedUseCases: [...answers.useCases],
    agentCapabilities: [...answers.agentCapabilities],
    recommendedConfiguration: {
      useCases: defaults.useCases,
      capabilities: answers.agentCapabilities.length
        ? [...answers.agentCapabilities]
        : defaults.capabilities,
      workflow: defaults.workflow,
      checklist,
    },
  };
}
