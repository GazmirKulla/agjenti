import { detailFields } from "./audio-fields";
import { PROFILE_TOPICS } from "@/lib/knowledge/profile-knowledge";

/** The detail questions added after the short onboarding questions, for the
 * admin "Onboarding Flow" page: when each is asked and where its answer goes.
 * Read-only; the rules live in audio-guide.ts (which questions, and their
 * titles) and are not switched off from the settings. */
export type DetailQuestion = { field: keyof typeof detailFields; title: string; when: string; savedTo: string; step: string };

const knowledge = (field: keyof typeof PROFILE_TOPICS) => `Njohuritë: «${PROFILE_TOPICS[field]}»`;

export const DETAIL_QUESTIONS: DetailQuestion[] = [
  { field: "customerProcess", step: "Profili: hapi 3 dhe karta «Gati për klientët»", title: "Si funksionon një porosi ose rezervim?",
    when: "Gjithmonë. Titulli ndryshon sipas asaj që bën Agjenti: porosi, rezervime ose kërkesa.", savedTo: knowledge("customerProcess") },
  { field: "handoffRules", step: "Udhëzimet: karta «Gati për klientët»", title: "Kur duhet Agjenti të ta kalojë bisedën ty?", when: "Gjithmonë.",
    savedTo: "Udhëzimet e Agjentit (nëse nuk i ke ndryshuar vetë)" },
  { field: "categoryDescription", step: "Profili: hapi 3 dhe karta «Gati për klientët»", title: "Çfarë biznesi ke?", when: "Kur tipi i biznesit është «Tjetër».", savedTo: knowledge("categoryDescription") },
];

/** Detail fields that are not asked as a question; answers given earlier are kept. */
export const NOT_ASKED: (keyof typeof detailFields)[] = [
  "businessCategory", "offeringsSummary", "customerQuestions", "hasVariants", "isPersonalized", "sellsProducts", "catalogContext", "businessDescription",
];
