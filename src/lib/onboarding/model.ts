export const questions = [
  {
    key: "businessType",
    label: "Lloji i biznesit",
    title: "Çfarë lloj biznesi ke?",
    description: "Do ta përshtatim hapësirën me mënyrën si punon.",
    options: [
      ["ecommerce", "Dyqan online", "products"],
      ["personalized", "Produkte të personalizuara", "spark"],
      ["fashion", "Veshje dhe modë", "products"],
      ["beauty", "Bukuri dhe kujdes", "spark"],
      ["electronics", "Elektronikë", "settings"],
      ["services", "Shërbime", "businesses"],
      ["other", "Tjetër", "dashboard"],
    ],
  },
  {
    key: "useCases",
    label: "Qëllimet",
    title: "Për çfarë do ta përdorësh Agjentin?",
    description: "Mund të zgjedhësh disa mundësi.",
    options: [
      ["messages", "Menaxhim mesazhesh në Instagram", "instagram"],
      ["support", "Mbështetje për klientët", "inbox"],
      ["sales", "Asistent shitjesh", "spark"],
      ["products", "Menaxhim produktesh", "products"],
      ["orders", "Menaxhim porosish", "orders"],
      ["customers", "Menaxhim klientësh", "customers"],
      ["recommendations", "Rekomandime produktesh", "agents"],
      ["collection", "Mbledhje të dhënash për porosi", "workflows"],
    ],
  },
  {
    key: "productCount",
    label: "Numri i produkteve",
    title: "Afërsisht sa produkte ose shërbime ofron?",
    description: "Një vlerësim mjafton. Mund ta zgjerosh katalogun më vonë.",
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
    label: "Produktet dhe shërbimet",
    title: "Çfarë shet ose ofron?",
    description: "Kjo na ndihmon të sugjerojmë konfigurimin e duhur.",
    options: [
      ["standard", "Produkte standarde", "products"],
      ["variants", "Produkte me masa ose ngjyra", "dashboard"],
      ["personalized", "Produkte me personalizim", "spark"],
      ["services", "Shërbime", "settings"],
      ["mixed", "Produkte dhe shërbime", "businesses"],
    ],
  },
  {
    key: "aiMode",
    label: "Agjenti AI",
    title: "Si dëshiron të punojë Agjenti AI?",
    description:
      "Kjo është preferenca fillestare. Aktivizimin e kontrollon vetë nga cilësimet.",
    options: [
      ["review", "Me mbikëqyrjen time", "customers"],
      ["support", "T’u përgjigjet pyetjeve të zakonshme", "inbox"],
      ["sales", "Të ndihmojë me shitje dhe rekomandime", "spark"],
      ["collect", "Të mbledhë detajet e porosisë", "orders"],
      ["workflow", "Të ndjekë procesin e plotë të porosisë", "workflows"],
    ],
  },
  {
    key: "messageVolume",
    label: "Vëllimi i mesazheve",
    title: "Sa mesazhe merr afërsisht në muaj?",
    description: "Do të sugjerojmë mënyrën e organizimit të Inbox-it.",
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
    options: [
      ["solo", "Vetëm unë", "customers"],
      ["2-5", "2–5 persona", "customers"],
      ["6-20", "6–20 persona", "customers"],
      ["20+", "Mbi 20 persona", "customers"],
    ],
  },
] as const;
export type AnswerKey = (typeof questions)[number]["key"];
export type Answers = {
  name: string;
  businessType: string;
  useCases: string[];
  productCount: string;
  productType: string;
  aiMode: string;
  messageVolume: string;
  teamSize: string;
};
export const emptyAnswers: Answers = {
  name: "",
  businessType: "",
  useCases: [],
  productCount: "",
  productType: "",
  aiMode: "",
  messageVolume: "",
  teamSize: "",
};
// Allow-list every field. Never persist arbitrary client-supplied JSON or permission flags.
export function parseAnswers(input: unknown, complete = false): Answers {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Përgjigjet nuk janë të vlefshme.");
  const raw = input as Record<string, unknown>;
  const result = { ...emptyAnswers, useCases: [] as string[] };
  if (typeof raw.name !== "string" || raw.name.trim().length > 100)
    throw new Error("Emri i biznesit duhet të ketë deri në 100 karaktere.");
  result.name = raw.name.trim();
  if (complete && result.name.length < 2)
    throw new Error("Vendos emrin e biznesit (të paktën 2 karaktere).");
  for (const q of questions) {
    const allowed: string[] = q.options.map((o) => o[0]);
    if (q.key === "useCases") {
      if (
        !Array.isArray(raw.useCases) ||
        raw.useCases.some((v) => typeof v !== "string" || !allowed.includes(v))
      )
        throw new Error("Zgjidh qëllime të vlefshme.");
      result.useCases = [...new Set(raw.useCases as string[])];
      if (complete && !result.useCases.length)
        throw new Error("Zgjidh të paktën një qëllim.");
    } else {
      const value = raw[q.key];
      if (
        typeof value !== "string" ||
        (value !== "" && !allowed.includes(value)) ||
        (complete && !value)
      )
        throw new Error(`Plotëso fushën: ${q.label}.`);
      result[q.key] = value;
    }
  }
  return result;
}
export function answerLabel(key: AnswerKey, value: string) {
  return (
    questions
      .find((q) => q.key === key)
      ?.options.find((o) => o[0] === value)?.[1] || value
  );
}
export function initialInstructions(a: Answers) {
  const modes: Record<string, string> = {
    review:
      "Përparësi ka mbikëqyrja nga stafi. Kërko ndihmën e stafit për paqartësi dhe mos premto veprime të pakonfirmuara.",
    support:
      "Përqendrohu te përgjigjet e qarta për pyetjet e zakonshme, bazuar vetëm te njohuritë e biznesit.",
    sales:
      "Ndihmo klientin të zgjedhë dhe rekomando produkte reale nga katalogu sipas nevojës së tij.",
    collect:
      "Mblidh vetëm të dhënat që kërkon hapi aktual i porosisë. Përmblidh detajet për konfirmim.",
    workflow:
      "Ndiq hapat e workflow-t të produktit dhe kërko konfirmimet përkatëse. Mos thuaj se porosia u krye pa konfirmim nga sistemi.",
  };
  return [
    `Je asistenti i biznesit ${a.name}. Fusha: ${answerLabel("businessType", a.businessType)}.`,
    "Përgjigju në shqip ose në gjuhën e klientit, me ton miqësor dhe profesional. Mos shpik çmime, stok ose politika. Përdor katalogun dhe njohuritë e biznesit. Nëse informacioni mungon, kërko ndihmën e stafit.",
    modes[a.aiMode],
    `Oferta: ${answerLabel("productType", a.productType)}. Qëllimet: ${a.useCases.map((v) => answerLabel("useCases", v)).join(", ")}.`,
    a.productType === "personalized"
      ? "Për personalizime ndiq kërkesat e workflow-t për foto, tekst dhe miratim; mos premto gjenerim ose prodhim që nuk është konfirmuar."
      : "Kërko sqarime për zgjedhjet e produktit ose shërbimit kur nevojiten.",
  ].join("\n\n");
}
export function recommendations(a: Answers) {
  return [
    a.productCount === "0"
      ? "Fillo me një produkt ose shërbim; katalogun mund ta zgjerosh gradualisht."
      : ["51-200", "200+"].includes(a.productCount)
        ? "Organizo katalogun sipas llojeve dhe shqyrto lidhjen e një katalogu të jashtëm te Cilësimet."
        : "Shto fillimisht produktet ose shërbimet që kërkohen më shpesh.",
    a.productType === "personalized"
      ? "Përdor workflow sipas llojit të produktit për foto, tekst dhe miratim."
      : a.productType === "services"
        ? "Shto shërbimet në katalog dhe shpjego kushtet e rezervimit te Njohuria."
        : a.productType === "variants"
          ? "Përshkruaj masat dhe ngjyrat në katalog dhe përshtat workflow-n sipas llojit."
          : "Plotëso përshkrimet dhe çmimet përpara se të aktivizosh përgjigjet automatike.",
    a.aiMode === "review"
      ? "Mbaj përgjigjet automatike të fikura dhe përgjigju manualisht nga Inbox-i. Preferenca nuk aktivizon një gjenerator sugjerimesh."
      : "Rishiko udhëzimet e përgatitura, aktivizo agjentin dhe më pas vendos nëse do dërgim automatik te Cilësimet.",
    ["501-2000", "2000+"].includes(a.messageVolume)
      ? "Për vëllimin tënd të mesazheve, përdor statuset e bisedave për të ndjekur rastet që kërkojnë staf."
      : "Kontrollo bisedat e para në Inbox për të përmirësuar përgjigjet dhe njohuritë.",
    a.teamSize === "solo"
      ? "Inbox-i dhe porositë janë të gjitha në hapësirën tënde."
      : "Për të shtuar ekipin, anëtarët regjistrohen dhe administratori i platformës i lidh me biznesin nga paneli ekzistues.",
  ];
}
