import { createHash } from "node:crypto";
import { assessCapability } from "@/lib/capabilities/assessment";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { saveKnowledgeEntry } from "@/lib/knowledge/actions";
import { uuid } from "@/lib/calendar/model";
import { AssistantError } from "./model";
import { canConfigureCapability } from "./activation-access";
import type { ActivationActor, CapabilityActivationResult } from "./activation-contract";

const capability = "knowledge.answer";
type Entry = { id: string; title: string; body: string; is_active: boolean; updated_at: string };
type Ticket = { purpose: "assistant-knowledge-activation-v1"; userId: string; businessId: string; entryId: string; updatedAt: string; contentHash: string; expires: number };
const columns = "id,title,body,is_active,updated_at";
const contentHash = (entry: Entry) => createHash("sha256").update(JSON.stringify([entry.title, entry.body])).digest("hex");
const validEntry = (entry: Entry) => typeof entry.title === "string" && Boolean(entry.title.trim()) && entry.title.length <= 8000 &&
  typeof entry.body === "string" && Boolean(entry.body.trim()) && entry.body.length <= 8000 && Number.isFinite(Date.parse(entry.updated_at));
async function assess(actor: ActivationActor) {
  try { return await assessCapability(actor.businessId, { userId: actor.userId }, capability); }
  catch { throw new AssistantError("Nuk u verifikua gatishmëria e njohurive. Rihap kontrollin."); }
}
async function prerequisite(actor: ActivationActor): Promise<CapabilityActivationResult> {
  if (!await canConfigureCapability(actor)) return { status: "unauthorized", changed: false, message: "Vetëm pronari ose administratori mund ta miratojë këtë konfigurim." };
  const assessment = await assess(actor);
  if (assessment.availability === "module_disabled" || assessment.missingRequirements.includes("module:knowledge"))
    return { status: "disabled", changed: false, assessment, message: "Moduli Njohuri është i çaktivizuar ose nuk lejohet nga paketa. Ky dialog nuk ndryshon modulet ose lejet." };
  if (assessment.status === "ready") return { status: "ready", changed: false, assessment, message: "Përgjigjet nga njohuritë janë tashmë gati. Nuk nevojitet ndryshim." };
  if (assessment.status !== "needs_setup" || assessment.missingRequirements.length !== 1 || assessment.missingRequirements[0] !== "active_knowledge")
    return { status: "blocked", changed: false, assessment, message: "Konfigurimi i njohurive kërkon verifikim tjetër." };
  return { status: "available", changed: false, assessment, message: "Shqyrto përmbajtjen dhe zgjidh njohurinë që agjenti mund të përdorë në përgjigje. Nuk do të gjenerohet ose ndryshohet përmbajtja." };
}
export async function inspectKnowledgeActivation(actor: ActivationActor): Promise<CapabilityActivationResult> {
  const result = await prerequisite(actor);
  if (result.status !== "available") return result;
  const { data, error } = await createServiceSupabase().from("knowledge_entries").select(columns)
    .eq("business_id", actor.businessId).eq("is_active", false).order("title").limit(21);
  if (error) throw new AssistantError("Njohuritë nuk u lexuan. Provo përsëri.");
  const options: NonNullable<CapabilityActivationResult["options"]> = ((data ?? []) as Entry[]).slice(0, 20).map(entry => {
    const ticket: Ticket = { purpose: "assistant-knowledge-activation-v1", userId: actor.userId, businessId: actor.businessId, entryId: entry.id,
      updatedAt: entry.updated_at, contentHash: contentHash(entry), expires: Date.now() + 10 * 60000 };
    return { id: entry.id, name: entry.title, detail: entry.body, ...(validEntry(entry) ? { token: encryptSecret(JSON.stringify(ticket)) } :
      { blocker: "Duhet titull, përmbajtje e plotë dhe version i vlefshëm. Plotëso njohurinë te ndërfaqja ekzistuese." }) };
  });
  return { ...result, options, partial: (data?.length ?? 0) > 20, ...(options.some(o => o.token) ? {} :
    { status: "blocked", message: "Nuk u gjet njohuri joaktive e plotësuar. Ky dialog nuk krijon ose shpik përmbajtje." }) };
}
function open(token: unknown, actor: ActivationActor): Ticket {
  try {
    if (typeof token !== "string" || token.length > 8000) throw Error();
    const t = JSON.parse(decryptSecret(token)) as Ticket;
    if (t.purpose !== "assistant-knowledge-activation-v1" || t.userId !== actor.userId || t.businessId !== actor.businessId || !uuid(t.entryId) ||
      !Number.isFinite(Date.parse(t.updatedAt)) || typeof t.contentHash !== "string" || !Number.isFinite(t.expires) || t.expires <= Date.now()) throw Error();
    return t;
  } catch { throw new AssistantError("Miratimi ka skaduar ose nuk i përket këtij përdoruesi/biznesi. Rihap konfigurimin e njohurive."); }
}
export async function confirmKnowledgeActivation(actor: ActivationActor, token: unknown): Promise<CapabilityActivationResult> {
  const ticket = open(token, actor);
  const before = await prerequisite(actor);
  if (before.status !== "available") return before;
  const current = await createServiceSupabase().from("knowledge_entries").select(columns)
    .eq("business_id", actor.businessId).eq("id", ticket.entryId).maybeSingle();
  if (current.error) throw new AssistantError("Njohuria nuk u verifikua. Nuk u bë ndryshim.");
  const entry = current.data as Entry | null;
  if (!entry || !validEntry(entry) || entry.is_active || entry.updated_at !== ticket.updatedAt || contentHash(entry) !== ticket.contentHash)
    throw new AssistantError("Njohuria ka ndryshuar ose është hequr. Rishqyrto përmbajtjen para miratimit.");
  const form = new FormData();
  for (const key of ["id", "title", "body", "updated_at"] as const) form.set(key, entry[key]);
  form.set("is_active", "on");
  form.set("activation_only", "true");
  let saved: Awaited<ReturnType<typeof saveKnowledgeEntry>>;
  try { saved = await saveKnowledgeEntry(actor.slug, form); }
  catch { return { status: "unverified", changed: null, message: "Rezultati i ruajtjes nuk u konfirmua. Rihap kontrollin përpara riprovimit." }; }
  if (saved.error) throw new AssistantError(saved.error);
  try {
    const assessment = await assess(actor);
    return { status: assessment.status === "ready" ? "activated" : "unverified", changed: true, assessment,
      message: assessment.status === "ready" ? "Njohuria u aktivizua dhe aftësia u rivlerësua si gati. Nuk u dërgua përgjigje dhe nuk u publikua workflow." :
        "Njohuria u aktivizua, por aftësia ende nuk është gati. Rihap kontrollin." };
  } catch { return { status: "unverified", changed: true, message: "Njohuria u aktivizua, por rivlerësimi dështoi. Mos e trajto aftësinë si gati." }; }
}
