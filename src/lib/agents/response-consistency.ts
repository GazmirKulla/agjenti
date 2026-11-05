import type { BusinessGrounding } from "./business-grounding";
import type { CustomerContext } from "./customer-context";
import { type ConversationStatePayload } from "@/lib/workflows/state";
import type { ReferenceProduct } from "@/lib/products/entity-bridge";
import { reviewInformationalResponse, codes, statuses } from "./response-review";

export type ConsistencyStatus = "valid" | "correctable" | "unsupported_critical_claim" | "contradiction" | "unverifiable" | "uncertain";
export type ConsistencyFinding = { status: Exclude<ConsistencyStatus, "valid">; code: string };
export type ConsistencyResult = { reply: string; changed: boolean; status: ConsistencyStatus; findings: ConsistencyFinding[] };
export type Evidence = {
  customer: CustomerContext;
  grounding?: BusinessGrounding;
  products: readonly ReferenceProduct[];
  services: readonly (ReferenceProduct & { duration_minutes?: number })[];
  message: string;
  informational: boolean;
  state: ConversationStatePayload;
};

const limitation = "Nuk kam të dhëna të verifikuara për këtë pohim. Për konfirmim, kontakto biznesin.";
/** A separate semantic review of informational prose. No state/effect writes,
 * no lexical claim detectors and no unchecked model rewrite. Domain executors
 * own receipt-backed action messages. Failure never releases unreviewed prose. */
export async function validateResponse(text: string, evidence: Evidence): Promise<ConsistencyResult> {
  const failed = (code: string): ConsistencyResult => ({ reply: limitation, changed: true, status: "uncertain", findings: [{ status: "uncertain", code }] });
  if (!text.trim() || text.length > 20000) return failed("invalid_response_size");
  try {
    const raw = await reviewInformationalResponse(text, evidence) as { findings: unknown };
    if (!raw || Object.keys(raw).length !== 1 || !Array.isArray(raw.findings) || raw.findings.length > 32
      || raw.findings.some((f: Record<string, unknown>) => !f || Object.keys(f).length !== 4
        || !statuses.includes(f.status as typeof statuses[number]) || !codes.includes(f.code as typeof codes[number])
        || (f.subject !== null && typeof f.subject !== "string")
        || typeof f.quote !== "string" || !f.quote.trim() || !text.includes(f.quote))) return failed("invalid_review");
    const findings: ConsistencyFinding[] = raw.findings.map((f: ConsistencyFinding) => ({ status: f.status, code: f.code }));
    if (!findings.length) return { reply: text, changed: false, status: "valid", findings: [] };
    // An earlier replacement must not hide a second overlapping unsafe claim.
    const ranges: Array<[number, number]> = [];
    for (const finding of raw.findings as Array<{ quote: string }>) {
      for (let start = text.indexOf(finding.quote); start >= 0; start = text.indexOf(finding.quote, start + finding.quote.length)) {
        const end = start + finding.quote.length;
        if (ranges.some(([a,b]) => start < b && end > a)) return failed("overlapping_review");
        ranges.push([start,end]);
      }
    }
    // Do not attempt another unsupported paraphrase after verification failed.
    const status = (["unsupported_critical_claim", "contradiction", "unverifiable", "uncertain", "correctable"] as const)
      .find(s=>findings.some(f=>f.status===s))!;
    // A correction is a complete safe response, never a substring splice into
    // rejected prose. The generator may recompose once and review the whole reply.
    const reply = [...new Set((raw.findings as Array<ConsistencyFinding & { quote: string; subject: string | null }>)
      .map(finding => correctClaim(finding, evidence)))].join("\n");
    return { reply, changed: reply !== text, status, findings };
  } catch { return failed("review_unavailable"); }
}


/** Corrections render only already-authorized evidence, never model values. */
function correctClaim(f: ConsistencyFinding & { subject: string | null }, e: Evidence): string {
  if (f.code === "execution_receipt_absent") return "Nuk kam konfirmim nga sistemi që ky veprim është kryer. Përgatitja ose konfirmimi i kërkesës nuk provon ekzekutimin e saj.";
  if (f.code === "availability_unverified") return "Disponueshmëria nuk është verifikuar. Prania në katalog nuk provon stok ose termine të lira.";
  if (f.code === "structured_business_fact_mismatch") {
    const products = e.grounding?.products.records ?? e.products, services = e.grounding?.services.records ?? e.services;
    const p = products.find(p=>p.id===f.subject), s = services.find(s=>s.id===f.subject);
    if (Boolean(p) !== Boolean(s)) return `Për vlerat aktuale të katalogut: [[${p ? "product" : "service"}:${(p ?? s)!.id}]].${s?.duration_minutes ? ` Kohëzgjatja e konfiguruar: ${s.duration_minutes} min.` : ""}`;
  }
  if (f.code === "catalog_count_mismatch") return e.grounding?.products.total == null ? "Numri i plotë i produkteve nuk është verifikuar."
    : `Në katalog janë ${e.grounding.products.total} produkte aktive; ky numër nuk tregon stokun.`;
  if (f.code === "partial_catalog_claimed_complete") return "Lista e disponueshme është e pjesshme; nuk provon përmbajtjen e gjithë katalogut.";
  if (f.code === "unavailable_is_not_empty") return "Nuk mund të konfirmoj se katalogu është bosh nga të dhënat e këtij leximi.";
  if (f.code === "customer_fact_mismatch" || f.code === "customer_fact_unverified") {
    const labels: Record<string,string> = { name: "emrin", phone: "telefonin", email: "email-in", city: "qytetin", address: "adresën",
      business_type: "biznesin tënd", instagram_handle: "profilin në Instagram", stated_needs: "pyetjet/nevojat" };
    const statements = (e.customer.reference?.keys ?? []).map(key=>{
      const fact = e.customer.profile[key] ?? e.customer.declared[key];
      const unavailable = e.customer.unavailable?.find(f=>f.key===key);
      return fact?.authority === "customer_declared" && !fact.truncated ? `Ti ke deklaruar ${labels[key] ?? key}: ${fact.value}.`
        : `Për ${labels[key] ?? key}: ${unavailable && unavailable.reason !== "missing" ? "vlera nuk mund të verifikohet plotësisht në këtë kontekst" : "nuk kam deklarim të disponueshëm në këtë kontekst"}.`;
    });
    if (e.customer.reference?.relation === "sales_location") statements.push("Kanali i shitjes nuk është verifikuar nga këto deklarime. Profili në Instagram nuk provon se shet atje.");
    if (e.customer.reference?.process && !e.customer.process) statements.push("Nuk kam një proces të vlefshëm të përzgjedhur në këtë kontekst. Kjo nuk provon se të dhënat nuk janë dhënë më parë.");
    if (e.customer.process) {
      const fields = Object.entries(e.customer.process.fields).filter(([,v])=>v.authority==="customer_declared"&&!v.truncated);
      if (fields.length) statements.push(`Për kërkesën aktuale ke deklaruar: ${fields.map(([k,v])=>`${k}: ${v.value}`).join("; ")}. Këto janë deklarime, jo rezultat ekzekutimi apo diagnozë e verifikuar.`);
    }
    return statements.join("\n") || limitation;
  }
  if (f.code === "known_profile_reasked" && f.subject && e.customer.suppliedProfileKeys?.includes(f.subject)) return "Këtë të dhënë e ke dhënë tashmë.";
  if (f.code === "resolved_entity_reasked" && e.customer.process?.entity) return "Përzgjedhja është tashmë në kontekstin e kërkesës.";
  return limitation;
}
