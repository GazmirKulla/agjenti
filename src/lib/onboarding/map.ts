import { questions, type AnswerKey } from "./model";
import {
  businessProfiles,
  capabilityChoices,
  offeringChoices,
  useCaseCapabilities,
  useCaseChoices,
  type BusinessType,
  type Choice,
} from "./rules";

export type OnboardingLink = {
  from: AnswerKey;
  to: AnswerKey;
  description: string;
};

export type WizardStep = {
  index: number;
  key: AnswerKey;
  label: string;
  shortLabel: string;
  title: string;
  description: string;
  optional: boolean;
  options: readonly Choice[];
  howItWorks: string;
  influencedBy: AnswerKey[];
  influences: AnswerKey[];
};

export type ProfileLinkRow = {
  businessType: BusinessType;
  label: string;
  offerings: Choice[];
  useCases: Choice[];
  capabilities: Choice[];
  useCaseCapabilityLinks: {
    useCase: Choice;
    capabilities: Choice[];
  }[];
};

const wizardOrder: AnswerKey[] = [
  "businessType",
  "productType",
  "useCases",
  "aiMode",
  "productCount",
  "messageVolume",
  "teamSize",
];

const shortLabels: Record<AnswerKey, string> = {
  businessType: "Lloji i biznesit",
  productType: "Çfarë ofron?",
  useCases: "Çfarë dëshiron të bëjë?",
  aiMode: "Çfarë duhet të bëjë Agjenti?",
  productCount: "Sa produkte/shërbime?",
  messageVolume: "Volumi i mesazheve",
  teamSize: "Madhësia e ekipit",
};

const howItWorks: Record<AnswerKey, string> = {
  businessType:
    "Zgjedhja e llojit të biznesit hap profilin bazë dhe filtrron ofertat, qëllimet dhe aftësitë e lejuara në hapat e mëvonshëm.",
  productType:
    "Opsionet e ofertës filtrohen nga lloji i biznesit. Nëse zgjidhet vetëm shërbime, qëllimet dhe aftësitë e produkteve fshihen.",
  useCases:
    "Qëllimet varen nga lloji i biznesit dhe oferta. Pa të paktën një qëllim, hapi i aftësive të Agjentit nuk shfaqet.",
  aiMode:
    "Aftësitë e mundshme lidhen me qëllimet e zgjedhura dhe kufizohen nga profili i biznesit dhe lloji i ofertës.",
  productCount:
    "Hap i pavarur opsional. Nuk filtrron hapat e tjerë; përdoret për rekomandime pas krijimit të hapësirës.",
  messageVolume:
    "Hap i pavarur opsional. Ndihmon sugjerimin e organizimit të Inbox-it, pa ndikuar opsionet e hapave të tjerë.",
  teamSize:
    "Hap i pavarur opsional. Informativ për madhësinë e ekipit; nuk ndryshon aftësitë e Agjentit.",
};

function choiceByValue(
  choices: readonly Choice[],
  value: string,
): Choice | undefined {
  return choices.find(([key]) => key === value);
}

export function onboardingLinks(): OnboardingLink[] {
  return [
    {
      from: "businessType",
      to: "productType",
      description: "Opsionet e ofertës filtrohen sipas llojit të biznesit.",
    },
    {
      from: "businessType",
      to: "useCases",
      description: "Qëllimet e lejuara varen nga profili i biznesit.",
    },
    {
      from: "productType",
      to: "useCases",
      description:
        "Nëse oferta është vetëm shërbime, qëllimet e produkteve fshihen.",
    },
    {
      from: "useCases",
      to: "aiMode",
      description:
        "Aftësitë e Agjentit shfaqen vetëm kur ka të paktën një qëllim; opsionet lidhen me qëllimet e zgjedhura.",
    },
    {
      from: "businessType",
      to: "aiMode",
      description: "Çdo profil biznesi kufizon aftësitë e lejuara.",
    },
    {
      from: "productType",
      to: "aiMode",
      description:
        "Aftësitë e katalogut/porosive fshihen kur oferta është vetëm shërbime.",
    },
  ];
}

function relatedKeys(key: AnswerKey, direction: "from" | "to") {
  const links = onboardingLinks();
  const set = new Set<AnswerKey>();
  for (const link of links) {
    if (direction === "from" && link.to === key) set.add(link.from);
    if (direction === "to" && link.from === key) set.add(link.to);
  }
  return wizardOrder.filter((item) => set.has(item));
}

function stepOptions(key: AnswerKey): readonly Choice[] {
  if (key === "productType") return offeringChoices;
  if (key === "useCases") return useCaseChoices;
  if (key === "aiMode") return capabilityChoices;
  return questions.find((item) => item.key === key)?.options ?? [];
}

export function wizardSteps(): WizardStep[] {
  return wizardOrder.map((key, index) => {
    const question = questions.find((item) => item.key === key)!;
    return {
      index: index + 1,
      key,
      label: question.label,
      shortLabel: shortLabels[key],
      title: question.title,
      description: question.description,
      optional: "optional" in question && Boolean(question.optional),
      options: stepOptions(key),
      howItWorks: howItWorks[key],
      influencedBy: relatedKeys(key, "from"),
      influences: relatedKeys(key, "to"),
    };
  });
}

export function profileLinkRows(): ProfileLinkRow[] {
  return (Object.keys(businessProfiles) as BusinessType[]).map((type) => {
    const profile = businessProfiles[type];
    const offerings = profile.allowedOfferingTypes
      .map((value) => choiceByValue(offeringChoices, value))
      .filter((item): item is Choice => Boolean(item));
    const useCases = profile.allowedUseCases
      .map((value) => choiceByValue(useCaseChoices, value))
      .filter((item): item is Choice => Boolean(item));
    const allowedCaps = new Set<string>(profile.allowedCapabilities);
    const capabilities = profile.allowedCapabilities
      .map((value) => choiceByValue(capabilityChoices, value))
      .filter((item): item is Choice => Boolean(item));
    const useCaseCapabilityLinks = profile.allowedUseCases
      .map((useCaseKey) => {
        const useCase = choiceByValue(useCaseChoices, useCaseKey);
        if (!useCase) return null;
        const caps = (useCaseCapabilities[useCaseKey] ?? [])
          .map((cap) => choiceByValue(capabilityChoices, cap))
          .filter((item): item is Choice => Boolean(item))
          .filter(([value]) => allowedCaps.has(value));
        return caps.length ? { useCase, capabilities: caps } : null;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return {
      businessType: type,
      label: profile.label,
      offerings,
      useCases,
      capabilities,
      useCaseCapabilityLinks,
    };
  });
}

export function questionLabel(key: AnswerKey) {
  return questions.find((item) => item.key === key)?.label ?? key;
}

export function stepIndex(key: AnswerKey) {
  return wizardOrder.indexOf(key) + 1;
}

/** Profilet e shfaqura si tab në eksplorues (si në mockup). */
export const exploreProfileOrder: BusinessType[] = [
  "ecommerce",
  "services",
  "fashion",
  "other",
];
