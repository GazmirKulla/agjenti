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

export type ProfileLinkRow = {
  businessType: BusinessType;
  label: string;
  offerings: Choice[];
  useCases: Choice[];
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

function choiceByValue(
  choices: readonly Choice[],
  value: string,
): Choice | undefined {
  return choices.find(([key]) => key === value);
}

export function wizardSteps() {
  return wizardOrder.map((key, index) => {
    const question = questions.find((item) => item.key === key)!;
    return {
      index: index + 1,
      key,
      label: question.label,
      title: question.title,
      optional: Boolean(question.optional),
    };
  });
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
      useCaseCapabilityLinks,
    };
  });
}

export function questionLabel(key: AnswerKey) {
  return questions.find((item) => item.key === key)?.label ?? key;
}
