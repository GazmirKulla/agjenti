import type { BusinessGrounding } from "./business-grounding";
import type { CustomerContext } from "./customer-context";
import { foldText, type ConversationStatePayload } from "@/lib/workflows/engine";
import type { ReferenceProduct } from "@/lib/products/entity-bridge";
import { customerFactReference } from "./customer-fact-reference";
import { isQuestion } from "@/lib/workflows/context";

export type ConsistencyStatus = "valid" | "correctable" | "unsupported_critical_claim" | "contradiction" | "unverifiable" | "uncertain";
export type ConsistencyFinding = { status: Exclude<ConsistencyStatus, "valid">; code: string };
export type ConsistencyResult = { reply: string; changed: boolean; status: ConsistencyStatus; findings: ConsistencyFinding[] };
type Evidence = {
  customer: CustomerContext;
  grounding?: BusinessGrounding;
  products: readonly ReferenceProduct[];
  services: readonly (ReferenceProduct & { duration_minutes?: number })[];
  message: string;
  informational: boolean;
  state: ConversationStatePayload;
};

const limitation = "Nuk kam të dhëna të verifikuara për këtë pohim. Për konfirmim, kontakto biznesin.";
const executionUnknown = "Nuk kam konfirmim nga sistemi që ky veprim është kryer. Përgatitja ose konfirmimi i kërkesës nuk provon ekzekutimin e saj.";
const normalize = (text: string) => foldText(text).replace(/\s+/g, " ").trim();
// Deliberately bounded Albanian/English claim recognizers, NOT a universal
// semantic validator. Numeric checks and corrections below require typed data.
// Execution receipts are intentionally NOT an input: this informational generator
// has no execution authority. Receipt-backed replies stay in domain adapters.
const actionClaims = [
  /\b(?:porosi\w*|rezervim\w*|pages\w*|order|booking|payment)\b.{0,35}\b(?:eshte ne pritje|po procesohet|is pending|is processing)\b/,
  /\b(?:tentuam|tentova|we attempted|i attempted)\b.{0,35}\b(?:dergo\w*|krijo\w*|rezervo\w*|submit|create|book)\b/,
  /\b(?:porosi\w*|rezervim\w*|takim\w*|pages\w*|order|booking|payment)\b.{0,45}\b(?:u (?:krye|perfundu[ae]|realizua)|eshte (?:kryer|perfunduar|realizuar))\b/,
  /\b(?:njoftim\w*|mesazh\w*|notification|message)\b.{0,25}\b(?:iu dergua|u dergua|eshte derguar|was sent|has been sent)\b/,
  /\b(?:rezervuam|rezervova|regjistruam|konfirmuam|njoftuam|derguam)\b.{0,35}\b(?:takim\w*|rezervim\w*|porosi\w*|klient\w*|staf\w*|ekip\w*)\b/,
  /\b(?:porosi\w*|order\w*)\b.{0,45}\b(?:u krijua|u dergua|u regjistrua|u konfirmua|eshte (?:krijuar|konfirmuar|derguar)|(?:has been |is |was )?(?:placed|created|submitted|confirmed))\b/,
  /\b(?:rezervim\w*|takimi|booking|appointment)\b.{0,45}\b(?:u (?:konfirmua|rezervua|ndryshua|anulua)|eshte (?:konfirmuar|rezervuar|anuluar)|(?:has been |is |was )?(?:confirmed|booked|reserved|cancelled|rescheduled))\b/,
  /\b(?:pagesa|payment)\b.{0,35}\b(?:u (?:mor|pranua|krye)|eshte (?:pranuar|kryer)|(?:has been |is |was )?(?:received|accepted|processed))\b/,
  /\b(?:klienti|customer|account)\b.{0,35}\b(?:u (?:regjistrua|krijua)|eshte regjistruar|(?:has been |is |was )?(?:registered|created))\b/,
  /\b(?:stafi|ekipi|operatori|staff|team)\b.{0,35}\b(?:u njoftua|eshte njoftuar|(?:has been |was )?notified|po e trajton|has taken over)\b/,
  /\b(?:ju |te |e |i |i have |i've |we have |we've )?(?:rezervova|konfirmova|regjistrova|njoftova|kam njoftuar|kam rezervuar|have booked|have notified|transferred you|booked your|registered you)\b/,
  /\b(?:biseda|conversation)\b.{0,25}\b(?:u transferua|iu kalua|kaloi te|transferred|handed over)\b/,
  /\b(?:zbritj\w*|discount|promotion)\b.{0,35}\b(?:u miratua|eshte miratuar|approved|applied)\b/,
  /\b(?:i|we) (?:have |successfully )?(?:created your order|confirmed your booking|received your payment|registered you|notified the staff)\b/,
  /\b(?:kam|kemi) (?:krijuar|konfirmuar|derguar|regjistruar|rezervuar|pranuar)\b.{0,30}\b(?:porosi\w*|rezervim\w*|takim\w*|pages\w*|klient\w*)\b/,
  /\b(?:porosi\w*|rezervim\w*|pages\w*|order|booking|payment)\b.{0,30}\b(?:deshtoi|u refuzua|failed|was rejected)\b/,
];
const availability = /\b(?:ne stok|ne gjendje|in stock|out of stock|termine? te lira|orare te lira|slots? (?:are )?(?:available|unavailable)|appointment availability|stok i garantuar)\b/;
const policy = /\b(?:derges\w*|transport\w*|dorezim\w*|rimburs\w*|kthim\w*|pages\w*|zbritj\w*|promocion\w*|shipping|delivery|refund\w*|return policy|payment|discount\w*|promotion\w*)\b/;
const policyAssertion = /\b(?:eshte|jane|kemi|ofrojme|pranojme|behet|kryhet|zgjat|brenda|falas|kushton|lejohet|mund te|gjithmone|miratua|aprovua|is|are|we (?:offer|accept|ship)|within|free|costs|can|always|approved)\b|\d/;
const uncertainty = /\b(?:nuk (?:kam|kemi) (?:informacion|te dhena|burim|konfirmim)|nuk mund|nuk (?:eshte|jane) verifikuar|nuk e di|pa konfirmim|e paverifikuar|nuk konfirmon|nuk garanton|not (?:verified|confirmed|guaranteed)|cannot (?:confirm|verify)|do not know|don't know|no verified)\b/;
function affirmed(sentence: string, match: RegExpExecArray) {
  // Negation belongs to the claim's own clause, not an unrelated earlier sentence.
  const before = sentence.slice(Math.max(0, match.index - 55), match.index);
  const claim = match[0];
  return !uncertainty.test(before + claim)
    && !/\b(?:nuk|not|never|if|nese|kur|when|sikur|mund|duhet|synojme|tentuam|tentova|kerkuam|propozojme|would|could|should|trying|attempted|requested)\b/.test(before)
    && !/\b(?:nuk|not|never)\b/.test(claim);
}
// Polarity belongs to a proposition, not a whole paragraph/window. In R4 an
// unrelated "nuk e di" suppressed a later completed-action assertion. Split
// coordination as well as contrast; never let one claim authorize its sibling.
function claimClauses(text: string, literals: string[] = []) {
  const spans: Array<[number, number]> = [];
  for (const literal of literals.filter(Boolean)) {
    for (let at = text.indexOf(literal); at >= 0; at = text.indexOf(literal, at + literal.length)) spans.push([at, at + literal.length]);
  }
  const clauses: string[] = []; let start = 0;
  for (const match of text.matchAll(/(?:\s*[,;]\s*|\s+)(?:por|mirepo|megjithate|ndersa|but|however|yet|dhe|and)\s+|;\s*|,\s+(?=\D)/gi)) {
    if (spans.some(([a, b]) => match.index >= a && match.index + match[0].length <= b)) continue;
    clauses.push(text.slice(start, match.index)); start = match.index + match[0].length;
  }
  return [...clauses, text.slice(start)];
}

// Bounded lexical support for customer recall, not a general entailment model.
// Exact values alone cannot validate "not <value>" or "<value> and <invention>".
// Strip only presentation words; every remaining token must be supported by the
// requested facts. Unknown assertions get an attributed, canonical restatement.
const presentationWords = new Set("ti ju ke keni te me e i a u yt jote juaj tuaj yte tende tend tua eshte jane quhesh quheni emri emrin telefonin telefoni email adresen adresa qyteti qytetin profilin profili ne instagram instagramin biznesi biznesin biznesit deklaruar thene treguar dhene shkruar sipas deklarimit deklarimeve tua fundit korrigjimit shet shes shitje ofron ofroj ofrimi dhe po pra sakte you your is are have told said declared name business profile on sell selling offer according to".split(" "));
const words = (text: string) => normalize(text).replace(/@(?=[a-z0-9_])/g, "").split(/[^a-z0-9_]+/).filter(Boolean);
const stem = (word: string) => word.replace(/(?:ash|esh|in|it|at|et|a|i|e)$/, "");
function supportedRecall(answer: string, values: string[], inflectedValues: string[] = []) {
  const expected = values.flatMap(words);
  const inflections = inflectedValues.flatMap(words);
  return words(answer).every(word => presentationWords.has(word) || expected.includes(word)
    // Albanian noun inflection, never numeric values/short names or arbitrary
    // prefix matching (which accepted unsupported extensions of a known fact).
    || inflections.some(value => value.length >= 4 && word.length >= 4
      && stem(value) === stem(word)));
}
const labels: Record<string, { label: string; question: RegExp }> = {
  name: { label: "Emrin", question: /\b(?:quhesh|quhem|emr\w*|name)\b/ },
  phone: { label: "Telefonin", question: /\b(?:telefon\w*|numri|phone)\b/ },
  email: { label: "Email-in", question: /\bemail\b/ },
  city: { label: "Qytetin", question: /\b(?:qytet\w*|city)\b/ },
  address: { label: "Adresën", question: /\b(?:adres\w*|address)\b/ },
};

/** Read-only, request-local boundary. Never changes facts, cursor, approvals or
 * routing. 'valid' means no supported violation detected, NOT certified truth. */
export function validateResponse(text: string, evidence: Evidence): ConsistencyResult {
  const findings: ConsistencyFinding[] = [];
  if (!text.trim() || text.length > 20000) return { reply: limitation, changed: true, status: "uncertain", findings: [{ status: "uncertain", code: "invalid_response_size" }] };
  const add = (status: ConsistencyFinding["status"], code: string) => findings.push({ status, code });
  const grounding = evidence.grounding;
  // Prefer the currently authorized R2 read to any compatibility projection.
  const products = grounding ? grounding.products.records : evidence.products;
  const services = grounding ? grounding.services.records : evidence.services;
  const entities = [...products.map(p => ({ ...p, kind: "product" })), ...services.map(s => ({ ...s, kind: "service" }))];
  // Exact delimited names/IDs only. Output correction must not fuzzy-select an
  // entity or match a short catalog name inside an unrelated word.
  const namesEntity = (clause: string, entity: typeof entities[number]) => {
    const name = normalize(entity.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return clause.includes(`[[${entity.kind}:${entity.id}]]`)
      || Boolean(name && new RegExp(`(?:^|[^a-z0-9])${name}(?:$|[^a-z0-9])`).test(normalize(clause)));
  };
  const sources = grounding ? [...grounding.knowledge.records.map(k => k.body), ...grounding.documents.records.map(d => d.excerpt)].map(normalize) : [];
  const safeKnowledge = (claim: string) => {
    const excerpt = claim.replace(/[.!]+$/, "");
    const topic = policy.exec(claim)?.[0];
    const relevant = topic ? sources.filter(source => source.includes(topic)) : [];
    // No inferred policy and no arbitrary winner between conflicting excerpts.
    // Conservative: extra relevant text may require clarification rather than synthesis.
    return claim.length >= 12 && relevant.length > 0 && relevant.every(source => source.includes(excerpt));
  };
  let reply = text.split(/(?<=[.!?])\s+|\n+/).map(part => {
    // Contrast clauses are validated independently; a disclaimer cannot launder
    // a second affirmative claim. Preserve the original sentence if unmodified.
    // Catalog text can contain conjunctions. Preserve those literal spans for
    // numeric attribution only; untrusted names must never shield action claims.
    for (const clause of claimClauses(normalize(part))) {
      if (!clause.endsWith("?") && actionClaims.some(pattern => { const match = pattern.exec(clause); return match && affirmed(clause, match); })) {
        add("unsupported_critical_claim", "execution_receipt_absent"); return executionUnknown;
      }
    }
    const clauses = claimClauses(normalize(part), entities.map(e => normalize(e.name)));
    for (const clause of clauses) {
      const normalized = normalize(clause);
      if (normalized.endsWith("?")) continue; // A question is not an execution receipt.
      const stock = availability.exec(normalized);
      if (stock && !/\b(?:nuk (?:kam|kemi) (?:te dhena|informacion|burim|konfirmim)|nuk mund|nuk (?:konfirmon|garanton)|nuk eshte verifikuar|cannot|unverified|not (?:verified|guaranteed)|if|nese)\b/.test(normalized)) {
        add("unsupported_critical_claim", "availability_unverified"); return "Disponueshmëria nuk është verifikuar. Prania në katalog nuk provon stok ose termine të lira.";
      }
      const policyClaim = policy.test(normalized) && policyAssertion.test(normalized) && !uncertainty.test(normalized)
        && !/^(?:nese|if|when|kur)\b/.test(normalized);
      if (policyClaim) {
        if (!safeKnowledge(normalized)) { add("unverifiable", "policy_evidence_absent"); return limitation; }
        // A verified shipping fee is a policy value, not a product price. Action
        // and availability claims above still cannot borrow policy authority.
        if (!entities.some(e => namesEntity(clause, e))) continue;
      }
      const numericPrices = [...normalized.matchAll(/(?:\b(\d+(?:[.,]\d+)?)\s*(eur|all|usd|gbp|leke|€|\$)|(eur|all|usd|gbp|[€$])\s*(\d+(?:[.,]\d+)?))/g)];
      const duration = /\b(\d+)\s*(?:minuta|min|minutes)\b/.exec(normalized);
      const freePrice = /\b(?:eshte falas|is free|kushton zero|costs nothing)\b/.test(normalized);
      if (numericPrices.length || duration || freePrice) {
        // Attribute each proposition's values to its own unique entity. The
        // former sentence-wide check rejected correct multi-price answers;
        // accepting a bag of catalog numbers instead would allow swapped prices.
        const named = entities.filter(e => namesEntity(clause, e));
        if (named.length !== 1) { add("unverifiable", "numeric_claim_entity_ambiguous"); return limitation; }
        const entity = named[0];
        const priceMismatch = freePrice && (entity.price_amount !== 0 || entity.price_mode === "from" || entity.price_mode === "request") || numericPrices.some(m => {
          const amount = Number((m[1] ?? m[4]).replace(",", "."));
          const raw = m[2] ?? m[3];
          const currency = ({ "€": "EUR", "$": "USD", leke: "ALL" } as Record<string, string>)[raw] ?? raw.toUpperCase();
          return amount !== entity.price_amount || currency !== entity.currency || entity.price_mode === "request"
            || entity.price_mode === "from" && !/\b(?:nga|from|starting at)\b/.test(normalized);
        });
        const durationMismatch = duration && (!("duration_minutes" in entity) || Number(duration[1]) !== entity.duration_minutes);
        if (priceMismatch || durationMismatch) {
          add("contradiction", "structured_business_fact_mismatch");
          // Replace only this claim, never infer a discount, total or unit conversion.
          return `Për vlerat aktuale të katalogut: [[${entity.kind}:${entity.id}]].${duration && "duration_minutes" in entity && entity.duration_minutes ? ` Kohëzgjatja e konfiguruar: ${entity.duration_minutes} min.` : ""}`;
        }
      }
      if (grounding) {
        const count = /\b(?:kemi|jane|ka|there are|we have)\s+(\d+)\s+(?:produkte|products)\b/.exec(normalized);
        if (count && (grounding.products.total === null || Number(count[1]) !== grounding.products.total)) {
          add("contradiction", "catalog_count_mismatch");
          return grounding.products.total === null ? "Numri i plotë i produkteve nuk është verifikuar." : `Në katalog janë ${grounding.products.total} produkte aktive; ky numër nuk tregon stokun.`;
        }
        if (/\b(?:te gjitha produktet|gjithe katalogu|all (?:our )?products|entire catalog)\b/.test(normalized) && grounding.products.status !== "complete" && !uncertainty.test(normalized)) {
          add("unverifiable", "partial_catalog_claimed_complete"); return "Lista e disponueshme është e pjesshme; nuk provon përmbajtjen e gjithë katalogut.";
        }
        if (/\b(?:nuk kemi|nuk ka|we have no|there are no)\s+(?:produkte|products|sherbime|services)\b/.test(normalized)) {
          const read = /\b(?:sherbime|services)\b/.test(normalized) ? grounding.services : grounding.products;
          if (read.status !== "no_match") { add("unverifiable", "unavailable_is_not_empty"); return "Nuk mund të konfirmoj se katalogu është bosh nga të dhënat e këtij leximi."; }
        }
      }
    }
    return part;
  }).join("\n");

  const user = normalize(evidence.message), answer = normalize(reply);
  // Share R1's fact reference; never independently route the conversation or
  // recover values from prior assistant prose. Keep verification scoped to the
  // projected fields, rather than exposing the whole customer profile.
  const requested = evidence.customer.reference ?? customerFactReference(evidence.message, evidence.state);
  const reference = isQuestion(evidence.message) || requested?.recall || /\b(?:dhashe|provided)\b/.test(user)
    ? requested : undefined;
  const declaredLabels: Record<string, string> = { instagram_handle: "profilin në Instagram", business_type: "biznesin tënd", stated_needs: "pyetjet/nevojat" };
  const recallLabels: Record<string, string[]> = {
    name: ["emri", "emrin", "name"], phone: ["telefoni", "telefonin", "phone"], email: ["email"], city: ["qyteti", "qytetin", "city"], address: ["adresa", "adresen", "address"],
    instagram_handle: ["instagram", "instagrami", "instagramin", "handle"], business_type: ["biznesi", "biznesin", "business"], stated_needs: ["pyetjet", "nevojat", "tipike", "questions", "needs"],
  };
  const namesFact = (clause: string, key: string) => recallLabels[key]?.some(label => words(clause).includes(label)) ?? false;
  const personal = reference?.keys.map(key => ({ key, fact: evidence.customer.profile[key] ?? evidence.customer.declared[key] }))
    .filter(item => item.fact?.authority === "customer_declared" && !item.fact.truncated) ?? [];
  const missing = reference?.keys.filter(key => !personal.some(p => p.key === key)) ?? [];
  const denialPattern = /\b(?:nuk ma ke|nuk me ke|nuk e di|nuk (?:eshte|jane|quhesh|quheni|shet)|nuk (?:ke|keni) (?:dhene|thene|treguar)|haven't told|have not told|don't know|not provided|is not|isn't)\b/;
  const absence = /\b(?:nuk|mungon|mungojne|unknown|unavailable|not|haven't|don't|missing)\b/;
  const personalAssertion = /\b(?:ti|ju|ke|keni|yt|jote|quhesh|quheni|you|your)\b/;
  const answerClauses = reply.split(/(?<=[.!?])\s+|\n+/).flatMap(sentence => claimClauses(normalize(sentence)));
  const denial = answerClauses.some(clause => denialPattern.test(clause)
    && personal.some(({ key, fact }) => namesFact(clause, key) || clause.includes(normalize(fact.value))));
  const containsFact = (key: string, value: string, claim = answer) => {
    const expected = normalize(value).replace(/^@/, "");
    if (new RegExp(`(?:^|[^a-z0-9_])${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9_])`).test(claim)) return true;
    if (key !== "business_type" && key !== "stated_needs") return false;
    // Bounded lexical paraphrases only (e.g. 'shitje rrobash online' / 'shet
    // rroba online'). Not a semantic truth classifier for arbitrary descriptions.
    const content = expected.split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !/^(shitje|shet|shes|ofroj|ofron|biznesi|eshte|online)$/.test(w));
    const words = claim.split(/[^a-z0-9]+/);
    return content.length > 0 && content.every(w => words.some(a => stem(a) === stem(w)))
      && (!expected.includes("online") || words.includes("online"));
  };
  const statements = personal.map(({ key, fact }) => `Ti ke deklaruar ${labels[key]?.label.toLowerCase() ?? declaredLabels[key]}: ${fact.value}.`);
  const personalAssertions = reply.split(/(?<=[.!?])\s+|\n+/).filter(sentence => !sentence.endsWith("?")
    && personalAssertion.test(normalize(sentence))
    && !/^(?:nese|sikur|if|suppose)\b/.test(normalize(sentence)));
  const unavailableStatements = missing.map(key => {
    const reason = evidence.customer.unavailable?.find(item => item.key === key)?.reason;
    return `Për ${labels[key]?.label.toLowerCase() ?? declaredLabels[key]}: ${reason && reason !== "missing" ? "vlera nuk mund të verifikohet plotësisht në këtë kontekst" : "nuk kam deklarim të disponueshëm në këtë kontekst"}.`;
  });
  const neverSupplied = /\b(?:nuk (?:(?:ma|me) )?ke|haven't|have not|never)\b.{0,25}\b(?:dhene|thene|treguar|supplied|provided|told)\b/;
  const unavailableClause = (clause: string) => absence.test(clause) && missing.some(key => namesFact(clause, key))
    && !neverSupplied.test(clause) && !personal.some(({ key }) => namesFact(clause, key));
  const supportedLabels = personal.flatMap(p => recallLabels[p.key] ?? []);
  const unsupportedExtension = personalAssertions.some(sentence => claimClauses(normalize(sentence)).some(clause => !uncertainty.test(clause) && !unavailableClause(clause)
    && !/^(?:nese|sikur|if|suppose)\b/.test(clause) && !supportedRecall(clause, [...personal.map(p => p.fact.value), ...supportedLabels],
      personal.filter(p => p.key === "business_type" || p.key === "stated_needs").map(p => p.fact.value))));
  const missingUnsupported = missing.some(key => !answerClauses.some(clause => namesFact(clause, key) && unavailableClause(clause)));
  const assignedMismatch = reply.split(/(?<=[.!?])\s+|\n+/).some(sentence =>
    claimClauses(normalize(sentence), personal.map(p => normalize(p.fact.value))).some(clause => {
      const named = personal.filter(({ key }) => namesFact(clause, key));
      return named.length === 1 && !containsFact(named[0].key, named[0].fact.value, clause) && !clause.endsWith("?");
    }));
  if (personal.length && (denial || unsupportedExtension || assignedMismatch || missingUnsupported || personal.some(({ key, fact }) => !containsFact(key, fact.value)))) {
    add("contradiction", `known_customer_${personal[0].key}`);
    reply = [...statements, ...unavailableStatements].join("\n");
  }
  const inventedMissing = reply.split(/(?<=[.!?])\s+|\n+/).some(sentence => claimClauses(normalize(sentence)).some(clause =>
    !clause.endsWith("?") && (!absence.test(clause) || neverSupplied.test(clause)) && missing.some(key => namesFact(clause, key))));
  if (reference?.keys.length && !personal.length && (inventedMissing || !uncertainty.test(answer)
    && /\b(?:ti (?:quhesh|shet|ofron|ke)|quhesh|emri yt|your (?:name|business|instagram))\b/.test(answer))) {
    add("unverifiable", "customer_fact_absent");
    reply = unavailableStatements.join("\n");
  }
  if (reference?.relation === "sales_location") {
    // A handle is a declaration, not account ownership or proof of a sales channel.
    const safe = "Kanali i shitjes nuk është verifikuar nga këto deklarime. Profili në Instagram nuk provon se shet atje.";
    if (!reply.includes(safe)) { add("unverifiable", "sales_channel_not_established"); reply = [...statements, safe].join("\n"); }
  }
  // Generic, process-owned recall uses only the selected authoritative projection,
  // never historical visual values, general preferences or the profile. Field
  // keys are server-defined, not a domain-specific list of ages/sizes/diagnoses.
  // Natural-language synonyms not present in this contract remain a limitation.
  const process = evidence.customer.process;
  if (reference?.process && !process) {
    add("unverifiable", "process_context_unavailable");
    reply = [...statements, ...unavailableStatements, evidence.customer.diagnostic === "ambiguous_process"
      ? "Cilën kërkesë dëshiron të rikujtosh? Ka disa procese dhe nuk do t’i bashkoj të dhënat e tyre."
      : "Nuk kam një proces të vlefshëm të përzgjedhur në këtë kontekst. Kjo nuk provon se të dhënat nuk janë dhënë më parë."].join("\n");
  }
  if (reference?.process && process) {
    const fields = Object.entries(process.fields).filter(([, f]) => f.authority === "customer_declared" && !f.truncated);
    // The selected process supplies a bounded set of configured fields. Correct
    // recall must not become a blanket absence claim, nor borrow profile facts.
    if (fields.length && (fields.some(([, f]) => !words(f.value).every(w => words(reply).includes(w)))
      || claimClauses(normalize(reply)).some(clause => absence.test(clause)
        && fields.some(([key, f]) => words(clause).includes(key) || normalize(clause).includes(normalize(f.value)))))) {
      add("contradiction", "known_process_facts");
      reply = [...statements, ...unavailableStatements, `Për kërkesën aktuale ke deklaruar: ${fields.map(([key, f]) => `${key}: ${f.value}`).join("; ")}.`].join("\n");
    }
  }
  if ((!reference || reference.process) && process) {
    const fields = Object.entries(process.fields).filter(([, f]) => f.authority === "customer_declared" && !f.truncated);
    const keyIn = (text: string, key: string) => new RegExp(`(?:^|[^a-z0-9_])${normalize(key).replace(/_/g, "[_ ]")}(?:$|[^a-z0-9_])`).test(text);
    reply = reply.split(/(?<=[.!?])\s+|\n+/).map(sentence => {
      const normalized = normalize(sentence);
      if (normalized.endsWith("?") || uncertainty.test(normalized) || /^(?:nese|sikur|if|suppose)\b/.test(normalized)) return sentence;
      const named = fields.filter(([key]) => keyIn(normalized, key));
      const assertsOwn = /\b(?:ti (?:ke|je)|ke deklaruar|yt|jote|juaj|your|you (?:have|are))\b/.test(normalized);
      if (!named.length && !assertsOwn) return sentence;
      const relevant = named.length ? named : fields;
      // A key/value assertion must carry THAT field's current value, not a
      // supported value from a different key in the same context.
      const mismatch = claimClauses(normalized).some(clause => {
        const claims = fields.filter(([key]) => keyIn(clause, key));
        return claims.some(([, f]) => !words(f.value).every(w => words(clause).includes(w)));
      });
      if (mismatch || !supportedRecall(sentence, relevant.flatMap(([key, f]) => [key, key.replace(/_/g, " "), f.value]))) {
        add("contradiction", "process_fact_unsupported");
        return relevant.length ? `Për kërkesën aktuale ke deklaruar: ${relevant.map(([key, f]) => `${key}: ${f.value}`).join("; ")}. Këto janë deklarime, jo rezultat ekzekutimi apo diagnozë e verifikuar.` : limitation;
      }
      return sentence;
    }).join("\n");
  }
  // Only free informational prose. Never suppress an executor's required prompt,
  // correction/review, invalid-field request or pending process clarification.
  const pending = evidence.state.context?.execution;
  const protectedQuestion = Boolean(evidence.state.processes?.pendingClarification || evidence.state.processes?.pendingChoice
    || evidence.state.visual?.awaiting || pending?.invalidFields?.length || /\b(?:ndrysho|korrigjo|change|correct|confirm|konfirm)\w*\b/.test(user));
  if (evidence.informational && !protectedQuestion) {
    reply = reply.split(/(?<=[.!?])\s+|\n+/).map(sentence => {
      const normalized = normalize(sentence);
      if (!normalized.endsWith("?") || !/\b(?:si|cili|cila|cilin|cilen|cfare|what|which|give|jep|dergo)\b/.test(normalized)) return sentence;
      const known = !/\b(?:biznes\w*|staf\w*|business|staff|company)\b/.test(normalized)
        && Object.entries(labels).find(([key, { question }]) => evidence.customer.suppliedProfileKeys?.includes(key) && question.test(normalized));
      if (known) { add("correctable", "known_profile_reasked"); return `${known[1].label} e ke dhënë tashmë.`; }
      if (/\b(?:cilin produkt|which product|cilin sherbim|which service)\b/.test(normalized) && evidence.customer.process?.entity
        && entities.some(e => e.id === evidence.customer.process!.entity!.id && e.kind === evidence.customer.process!.entity!.kind)) {
        add("correctable", "resolved_entity_reasked"); return "Përzgjedhja është tashmë në kontekstin e kërkesës.";
      }
      return sentence;
    }).join("\n");
    const history = evidence.state.recentMessages ?? [];
    const repeated = history.filter(m => m.role === "assistant" && normalize(m.content) === normalize(reply)).length;
    if (repeated >= 2 && /^(?:me fal|me vjen keq|sorry|i apologize)[.!\s]*$/i.test(normalize(reply))) {
      add("correctable", "repeated_apology"); reply = "Nuk kam informacion të ri të verifikuar. Mund ta specifikosh informacionin që të duhet, ose të kontaktosh biznesin.";
    }
  }
  // De-duplicate only identical boundary fallbacks, never configured questions.
  if (findings.length) reply = [...new Set(reply.split("\n"))].join("\n");
  else reply = text;
  const status = (["unsupported_critical_claim", "contradiction", "unverifiable", "uncertain", "correctable"] as const)
    .find(status => findings.some(f => f.status === status)) ?? "valid";
  return { reply, changed: reply !== text, status, findings };
}
