import { detailFields } from "./audio-fields";
import { PROFILE_TOPICS } from "@/lib/knowledge/profile-knowledge";

/** The detail questions added after the short onboarding questions, for the
 * admin "Onboarding Flow" page: when each is asked and where its answer goes.
 * Read-only; the rules live in audio-guide.ts (which questions, and their
 * titles) and are not switched off from the settings. */
export type DetailQuestion = { field: keyof typeof detailFields; title: string; when: string; savedTo: string };

const knowledge = (field: keyof typeof PROFILE_TOPICS) => `Njohuritë: «${PROFILE_TOPICS[field]}»`;

export const DETAIL_QUESTIONS: DetailQuestion[] = [
  { field: "offeringsSummary", title: "Çfarë ofron biznesi yt?",
    when: "Gjithmonë. Titulli ndryshon sipas ofertës: «Cilat produkte shet?», «Cilat shërbime ofron?».", savedTo: knowledge("offeringsSummary") },
  { field: "customerProcess", title: "Si funksionon një porosi ose rezervim?",
    when: "Gjithmonë. Titulli ndryshon sipas asaj që bën Agjenti: porosi, rezervime ose kërkesa.", savedTo: knowledge("customerProcess") },
  { field: "handoffRules", title: "Çfarë dëshiron të bëjë Agjenti dhe kur të të kërkojë ndihmë?", when: "Gjithmonë.", savedTo: "Udhëzimet e Agjentit" },
  { field: "categoryDescription", title: "Çfarë biznesi ke?", when: "Kur tipi i biznesit është «Tjetër».", savedTo: knowledge("categoryDescription") },
];

/** Detail fields that are not asked as a question; answers given earlier are kept. */
export const NOT_ASKED: (keyof typeof detailFields)[] = [
  "businessCategory", "customerQuestions", "hasVariants", "isPersonalized", "sellsProducts", "catalogContext", "businessDescription",
];
