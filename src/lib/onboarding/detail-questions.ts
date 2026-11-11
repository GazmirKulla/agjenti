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
  { field: "customerQuestions", title: "Çfarë të pyesin më shpesh klientët?", when: "Gjithmonë.", savedTo: knowledge("customerQuestions") },
  { field: "customerProcess", title: "Si funksionon një porosi ose rezervim?",
    when: "Gjithmonë. Titulli ndryshon sipas asaj që bën Agjenti: porosi, rezervime ose kërkesa.", savedTo: knowledge("customerProcess") },
  { field: "handoffRules", title: "Çfarë dëshiron të bëjë Agjenti dhe kur të të kërkojë ndihmë?", when: "Gjithmonë.", savedTo: "Udhëzimet e Agjentit" },
  { field: "hasVariants", title: "A kanë produktet variante?", when: "Kur oferta përfshin produkte (jo vetëm shërbime).", savedTo: "Profili i panelit" },
  { field: "isPersonalized", title: "A ofron personalizim?", when: "Kur oferta përfshin produkte (jo vetëm shërbime).", savedTo: "Profili i panelit" },
  { field: "sellsProducts", title: "A shet edhe produkte?", when: "Kur nuk është e qartë nëse biznesi shet produkte.", savedTo: "Profili i panelit" },
  { field: "catalogContext", title: "Si i përdor klienti katalogët e tu?", when: "Kur biznesi ka katalogë.", savedTo: knowledge("catalogContext") },
  { field: "categoryDescription", title: "Çfarë biznesi ke?", when: "Kur tipi i biznesit është «Tjetër».", savedTo: knowledge("categoryDescription") },
  { field: "businessDescription", title: "Përshkrimi i biznesit", when: "Kur ka tashmë një përshkrim (p.sh. nga skanimi), për ta konfirmuar.", savedTo: knowledge("businessDescription") },
];

/** Detail fields that are never asked as a question (filled elsewhere). */
export const NOT_ASKED: (keyof typeof detailFields)[] = ["businessCategory"];
