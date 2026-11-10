import "server-only";
import { CSV_IMPORT_REVIEW_PROMPT } from "@/lib/products/import-evaluation";
import { PRODUCT_DESCRIPTION_PROMPT } from "@/lib/products/prompts";
import { WORKFLOW_CAPABILITY_REVIEW_PROMPT } from "@/lib/capabilities/workflow-semantics";
import { WORKFLOW_REQUEST_MODE_PROMPT } from "@/lib/business-assistant/workflow-request";
import { REQUEST_RELATION_PROMPT } from "@/lib/business-assistant/request-relation";
import { CONFIGURATION_REVIEW_PROMPT } from "@/lib/business-assistant/configuration-review";
import { BRIEFING_INTENT_PROMPT } from "@/lib/business-assistant/briefing-intent";
import { OWNER_ASSISTANT_PROMPT } from "@/lib/business-assistant/service";
import { BUSINESS_CLASSIFICATION_PROMPT } from "@/lib/discovery/proposal";
import { CUSTOMER_JOURNEY_PROMPT } from "@/lib/discovery/business-process";
import { INSTRUCTION_FACTS_PROMPT } from "@/lib/agents/instruction-facts";
import { AGENT_INSTRUCTIONS_WRITER_PROMPT } from "@/lib/agents/prompts";
import { ONBOARDING_EXTRACTION_PROMPT, SOURCE_EXTRACTION_PROMPT } from "@/lib/business-intelligence/normalization";
import { fields } from "@/lib/business-intelligence/model";
import { REACTION_DECISION_PROMPT } from "@/lib/conversations/ai-reaction-decision";
import { FRAGMENT_OBSERVATION_PROMPT } from "@/lib/conversations/fragment-observation";
import { SEMANTIC_SELECTION_PROMPT } from "@/lib/conversations/understanding/selection";
import { CATALOG_INDEXING_PROMPT } from "@/lib/catalogs/indexing";
import { CATALOG_REQUIREMENTS_PROMPT, CATALOG_ROUTING_PROMPT } from "@/lib/catalogs/retrieval";
import { CUSTOMER_REPLY_PROMPT } from "@/lib/orchestration/respond";
import { observationInstructions } from "@/lib/orchestration/observation";
import { communicationPolicyInstructions } from "@/lib/agents/communication-policy";
import { trainingPrompt } from "@/lib/agents/training/model";
import { ONBOARDING_ANSWER_PROMPT } from "@/lib/onboarding/assistant-chat";

/** Every platform prompt sent to the AI, read from the same constants the
 * code uses, so what the admin reads is exactly what runs. Parts filled per
 * request are shown as ‹…›. Read-only for now. */

export type PromptArea = "customer" | "assistant" | "sources" | "catalog" | "agent" | "onboarding";
export type PromptModel = "customer" | "assistant" | "utility" | "vision";
export type PromptEntry = {
  id: string;
  area: PromptArea;
  title: string;
  /** Where and when it is used, in plain words. */
  use: string;
  /** What the model receives besides the prompt. */
  input: string;
  /** What it must return. */
  output: string;
  model: PromptModel;
  /** Parts filled for each request. */
  dynamic?: string[];
  file: string;
  text: string;
};

export const PROMPT_AREAS: Record<PromptArea, { title: string; description: string }> = {
  customer: { title: "Agjenti i klientëve", description: "Bisedat me klientët në Instagram dhe WhatsApp: kuptimi i mesazhit, përgjigja, reagimet." },
  assistant: { title: "Asistenti i pronarit", description: "Asistenti në panel që ndihmon pronarin të menaxhojë biznesin." },
  agent: { title: "Udhëzimet e Agjentit", description: "Shkrimi dhe pastrimi i udhëzimeve të agjentit të klientëve." },
  sources: { title: "Burimet dhe skanimi", description: "Leximi i Instagram-it, website-it dhe materialeve të biznesit." },
  catalog: { title: "Katalogët dhe produktet", description: "Indeksimi i katalogëve, kërkimi në to dhe ndihma për produktet." },
  onboarding: { title: "Onboarding", description: "Pyetjet e para kur krijohet një biznes." },
};

const slot = (name: string) => `‹${name}›`;

export function promptCatalog(): PromptEntry[] {
  return [
    {
      id: "customer.interpret", area: "customer", model: "customer", file: "src/lib/orchestration/observation.ts",
      title: "Kuptimi i mesazhit të klientit",
      use: "Për çdo mesazh të klientit, para përgjigjes: kupton çfarë kërkon, çfarë të dhënash jep dhe në cilin hap të procesit ndodhet.",
      input: "Mesazhi, historiku i fundit, procesi aktiv, fushat që priten, njohuritë e biznesit.",
      output: "Vëzhgime të strukturuara (fakte, qëllime, përgjigje ndaj pyetjeve) — kurrë leje për veprime.",
      text: observationInstructions,
    },
    {
      id: "customer.reply", area: "customer", model: "customer", file: "src/lib/orchestration/respond.ts",
      title: "Përgjigja ndaj klientit",
      use: "Shkruan mesazhin që i dërgohet klientit, pasi serveri ka vendosur hapat e procesit.",
      input: "Mesazhi, udhëzimet e agjentit të biznesit, njohuritë dhe produktet e zgjedhura, njoftimet e procesit.",
      output: "Përgjigja për klientin dhe pyetjet e hapave të procesit.",
      dynamic: ["Politika e komunikimit e agjentit (gjuha, toni, gjatësia)", "Mësimet nga Memoria"],
      text: `${slot("politika e komunikimit")}${slot("mësimet nga Memoria")}\n${CUSTOMER_REPLY_PROMPT}`,
    },
    {
      id: "customer.communication", area: "customer", model: "customer", file: "src/lib/agents/communication-policy.ts",
      title: "Politika e komunikimit (parazgjedhja)",
      use: "Pjesa e parë e përgjigjes ndaj klientit: gjuha, toni, gjatësia, pyetjet dhe emoji. Ndryshon sipas zgjedhjeve të çdo agjenti; kjo është parazgjedhja.",
      input: "Zgjedhjet e komunikimit të agjentit.", output: "Pjesë e promptit të përgjigjes.",
      text: communicationPolicyInstructions(),
    },
    {
      id: "customer.training", area: "customer", model: "customer", file: "src/lib/agents/training/model.ts",
      title: "Mësimet nga Memoria",
      use: "Shtohet te përgjigja kur biznesi ka mësime aktive: deri në 16 rregulla dhe 4 shembuj të afërt me pyetjen.",
      input: "Mësimet e pronarit (stil, shembuj, rregulla workflow-je).", output: "Pjesë e promptit të përgjigjes.",
      dynamic: ["Lista e mësimeve të biznesit"],
      text: trainingPrompt({ rules: [{ id: "shembull", kind: "style", instruction: slot("mësimi i pronarit"), question: "", response: "", scope: "business" }] }),
    },
    {
      id: "customer.relevance", area: "customer", model: "customer", file: "src/lib/conversations/understanding/selection.ts",
      title: "Zgjedhja e njohurive të duhura",
      use: "Zgjedh cilat njohuri lidhen me pyetjen e klientit (deri në 12), që Agjenti të lexojë vetëm atë që duhet.",
      input: "Mesazhi dhe titujt/tekstet e njohurive.", output: "Indekset e njohurive me shkallën e lidhjes.",
      text: SEMANTIC_SELECTION_PROMPT("relevance"),
    },
    {
      id: "customer.identity", area: "customer", model: "customer", file: "src/lib/conversations/understanding/selection.ts",
      title: "Njohja e produktit që përmend klienti",
      use: "Gjen cilin produkt ose shërbim ka parasysh klienti, edhe me gabime drejtshkrimi ose në gjuhë tjetër.",
      input: "Mesazhi dhe emrat e produkteve/shërbimeve.", output: "Indekset e kandidatëve të mundshëm.",
      text: SEMANTIC_SELECTION_PROMPT("identity"),
    },
    {
      id: "customer.reaction", area: "customer", model: "utility", file: "src/lib/conversations/ai-reaction-decision.ts",
      title: "Reagimi me emoji në fund të bisedës",
      use: "Vendos nëse në mbyllje pozitive të bisedës vihet një emoji i vogël te mesazhi i klientit.",
      input: "Bisedat e fundit, mesazhi aktual, përgjigja e përgatitur.", output: "Vendimi dhe emoji (ose asnjë).",
      text: REACTION_DECISION_PROMPT,
    },
    {
      id: "customer.fragment", area: "customer", model: "utility", file: "src/lib/conversations/fragment-observation.ts",
      title: "Mesazhet e copëzuara",
      use: "Kupton nëse klienti po e shkruan pyetjen në disa mesazhe, që Agjenti të presë pjesën tjetër.",
      input: "Copëza e mesazhit.", output: "Lloji i copëzës.",
      text: FRAGMENT_OBSERVATION_PROMPT,
    },
    {
      id: "customer.catalog-request", area: "catalog", model: "customer", file: "src/lib/catalogs/retrieval.ts",
      title: "Kërkesa për katalog ose dokument",
      use: "Kur klienti kërkon broshura, manuale ose katalogë: nxjerr kërkesat (gjuha, tregu, marka…). Pjesa e dytë shtohet kur ka pyetje të hapur.",
      input: "Mesazhi i klientit dhe kërkesat e mëparshme.", output: "Kërkesat me citim nga mesazhi.",
      dynamic: ["Etiketat e mbështetura nga katalogët e biznesit"],
      text: `${CATALOG_REQUIREMENTS_PROMPT(slot("etiketat e mbështetura"))}\n\n${CATALOG_ROUTING_PROMPT}`,
    },
    {
      id: "assistant.main", area: "assistant", model: "assistant", file: "src/lib/business-assistant/service.ts",
      title: "Asistenti i pronarit (prompti kryesor)",
      use: "Çdo kërkesë e pronarit te Asistenti: propozon veprimin (krijo, ndrysho, kërko, sqaro) që pronari e konfirmon.",
      input: "Kërkesa, historiku, faqja ku ndodhet, të dhënat e biznesit, operacionet e mundshme.",
      output: "Një veprim i propozuar ose pyetje sqaruese — kurrë veprim i kryer.",
      dynamic: ["Modulet aktive të biznesit", "A është katalogu i lidhur me API të jashtme"],
      text: OWNER_ASSISTANT_PROMPT([slot("modulet aktive")], false).replace(/External catalog: false\./, `External catalog: ${slot("po/jo")}.`),
    },
    {
      id: "assistant.review", area: "assistant", model: "assistant", file: "src/lib/business-assistant/configuration-review.ts",
      title: "Kontrolli i ndryshimeve të propozuara",
      use: "Kontroll i dytë, i pavarur: a janë hapat e propozuar brenda asaj që kërkoi pronari dhe a janë faktet të vërtetuara.",
      input: "Kërkesa dhe hapat e propozuar.", output: "Për çdo hap: brenda kërkesës? fakte të vërtetuara?",
      text: CONFIGURATION_REVIEW_PROMPT,
    },
    {
      id: "assistant.relation", area: "assistant", model: "utility", file: "src/lib/business-assistant/request-relation.ts",
      title: "Kërkesë e re apo vazhdim",
      use: "Dallon nëse mesazhi i pronarit nis një objektiv të ri apo vazhdon kërkesën e mëparshme.",
      input: "Mesazhi aktual dhe kërkesa e mëparshme.", output: "E re / vazhdim, me citim.",
      text: REQUEST_RELATION_PROMPT,
    },
    {
      id: "assistant.briefing", area: "assistant", model: "utility", file: "src/lib/business-assistant/briefing-intent.ts",
      title: "Përmbledhja e periudhës",
      use: "Kupton kur pronari kërkon një përmbledhje (sot, dje, këtë javë) të mesazheve, porosive ose rezervimeve.",
      input: "Kërkesa e pronarit.", output: "Periudha ose asgjë.",
      text: BRIEFING_INTENT_PROMPT,
    },
    {
      id: "assistant.workflow-mode", area: "assistant", model: "assistant", file: "src/lib/business-assistant/workflow-request.ts",
      title: "Ndryshimi i workflow-t: publiko, draft apo pyet",
      use: "Kur Asistenti ndryshon një workflow: vendos nëse ndryshimi publikohet, ruhet si draft, vetëm shfaqet, apo duhet sqarim.",
      input: "Kërkesa dhe workflow-i para/pas.", output: "Mënyra, me citim nga kërkesa.",
      text: WORKFLOW_REQUEST_MODE_PROMPT,
    },
    {
      id: "assistant.workflow-capabilities", area: "assistant", model: "assistant", file: "src/lib/capabilities/workflow-semantics.ts",
      title: "Aftësitë që kërkon një workflow",
      use: "Gjen cilat aftësi (porosi, stok, njoftime…) premton ose kërkon një workflow, që të mos premtohet diçka që platforma nuk e bën.",
      input: "Kërkesa dhe workflow-i kandidat.", output: "Aftësitë me citime.",
      text: WORKFLOW_CAPABILITY_REVIEW_PROMPT,
    },
    {
      id: "agent.write", area: "agent", model: "assistant", file: "src/lib/agents/prompts.ts",
      title: "Shkrimi i udhëzimeve me AI",
      use: "Butoni që gjeneron udhëzimet e agjentit nga produktet dhe shërbimet e biznesit.",
      input: "Emri i biznesit, produktet, shërbimet, njohuritë.", output: "Teksti i udhëzimeve.",
      text: AGENT_INSTRUCTIONS_WRITER_PROMPT,
    },
    {
      id: "agent.facts", area: "agent", model: "assistant", file: "src/lib/agents/instruction-facts.ts",
      title: "Faktet nga udhëzimet te Njohuritë",
      use: "\"Kontrollo udhëzimet\": ndan faktet (çmime, dërgesë…) nga sjellja dhe i propozon si njohuri.",
      input: "Udhëzimet e agjentit.", output: "Udhëzimet pa faktet, faktet, shënimet.",
      text: INSTRUCTION_FACTS_PROMPT,
    },
    {
      id: "sources.onboarding", area: "sources", model: "vision", file: "src/lib/business-intelligence/normalization.ts",
      title: "Njohja e biznesit nga Instagram-i dhe website-i",
      use: "Skanimi i burimeve: nxjerr profilin dhe njohuritë nga postimet, fotot dhe faqja e website-it.",
      input: "Tekstet dhe fotot e burimit.", output: "Profili dhe njohuritë, secila me citim nga burimi.",
      text: ONBOARDING_EXTRACTION_PROMPT({ profile: fields.profile, knowledge: fields.knowledge }),
    },
    {
      id: "sources.extract", area: "sources", model: "vision", file: "src/lib/business-intelligence/normalization.ts",
      title: "Nxjerrja e të dhënave nga materialet",
      use: "Kur pronari jep tekst, faqe ose foto për të plotësuar produkte, shërbime ose njohuri.",
      input: "Materiali dhe objektivi (produkt, shërbim, njohuri…).", output: "Entitete me fakte dhe citime.",
      dynamic: ["Objektivi i nxjerrjes"],
      text: SOURCE_EXTRACTION_PROMPT(slot("objektivi")),
    },
    {
      id: "sources.classify", area: "sources", model: "assistant", file: "src/lib/discovery/proposal.ts",
      title: "Lloji i biznesit",
      use: "Pas skanimit: rekomandon fushën e biznesit dhe çfarë ofron (produkte, shërbime, të dyja).",
      input: "Faktet e nxjerra nga burimet.", output: "Lloji i biznesit dhe oferta.",
      text: BUSINESS_CLASSIFICATION_PROMPT,
    },
    {
      id: "sources.journey", area: "sources", model: "assistant", file: "src/lib/discovery/business-process.ts",
      title: "Rruga e klientit (procesi i biznesit)",
      use: "Pas skanimit: përshkruan si zgjedh, porosit dhe merr klienti produktin, sipas burimeve.",
      input: "Tekstet e burimeve.", output: "Deri në 8 hapa me citime dhe të panjohurat.",
      text: CUSTOMER_JOURNEY_PROMPT,
    },
    {
      id: "catalog.index", area: "catalog", model: "assistant", file: "src/lib/catalogs/indexing.ts",
      title: "Indeksimi i katalogut",
      use: "Kur ngarkohet një katalog (PDF ose link): e ndan në seksione që Agjenti i gjen më vonë.",
      input: "Dokumenti.", output: "Seksione, përmbledhje dhe mbulimi.",
      text: CATALOG_INDEXING_PROMPT,
    },
    {
      id: "catalog.csv", area: "catalog", model: "assistant", file: "src/lib/products/import-evaluation.ts",
      title: "Vlerësimi i importit CSV",
      use: "Kur pronari importon produkte nga CSV: propozon kolonat dhe tregon problemet.",
      input: "Kolonat dhe rreshtat e CSV-së.", output: "Lidhja e kolonave dhe këshilla.",
      text: CSV_IMPORT_REVIEW_PROMPT,
    },
    {
      id: "catalog.description", area: "catalog", model: "assistant", file: "src/lib/products/prompts.ts",
      title: "Përshkrimi i produktit me AI",
      use: "Butoni që shkruan një përshkrim të shkurtër për produktin.",
      input: "Emri i biznesit, i produktit dhe lloji.", output: "Përshkrimi (deri ~200 karaktere).",
      text: PRODUCT_DESCRIPTION_PROMPT,
    },
    {
      id: "onboarding.answer", area: "onboarding", model: "utility", file: "src/lib/onboarding/assistant-chat.ts",
      title: "Përgjigjet e pronarit gjatë onboarding-ut",
      use: "Kur Asistenti i bën pyetjet e konfigurimit: kupton nëse pronari u përgjigj, e kaloi pyetjen ose kërkoi diçka tjetër.",
      input: "Pyetja dhe përgjigja e pronarit.", output: "Lloji i përgjigjes dhe vlerat e zgjedhura.",
      text: ONBOARDING_ANSWER_PROMPT,
    },
  ];
}
