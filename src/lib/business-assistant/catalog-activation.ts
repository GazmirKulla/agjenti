import { assessCapability } from "@/lib/capabilities/assessment";
import { getCapability, type CapabilityAssessment } from "@/lib/capabilities/registry";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { requireCatalogActivation } from "@/lib/products/activation";
import { productCatalogColumns, type ProductRow } from "@/lib/products/catalog";
import { updateCatalogField } from "@/lib/products/inline-actions";
import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";
import { AssistantError } from "./model";

const capability = "product.search";
type Actor = { userId: string; businessId: string; slug: string; catalogSource: string };
type Ticket = { purpose: "assistant-catalog-activation-v1"; capability: typeof capability; userId: string; businessId: string; productId: string; updatedAt: string; expires: number };
export type CatalogActivationResult = {
  status: "available" | "ready" | "disabled" | "unauthorized" | "unsupported" | "blocked" | "activated" | "unverified";
  message: string;
  assessment?: CapabilityAssessment;
  /** Acknowledged configuration write; null means the write outcome is unknown. */
  changed: boolean | null;
  partial?: boolean;
  options?: { id: string; name: string; price: number | null; currency: string; token?: string; blocker?: string }[];
};

async function canConfigure(actor: Actor) {
  const db = createServiceSupabase();
  const [member, admin] = await Promise.all([
    db.from("business_users").select("role").eq("business_id", actor.businessId).eq("user_id", actor.userId).maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", actor.userId).maybeSingle(),
  ]);
  if (member.error || admin.error) throw new AssistantError("Nuk u verifikuan lejet. Provo përsëri.");
  return member.data?.role === "owner" || Boolean(admin.data);
}

async function assess(actor: Actor) {
  try {
    const { capabilityKey, status, availability, reasonCode, missingRequirements } = await assessCapability(actor.businessId, { userId: actor.userId }, capability);
    return { capabilityKey, status, availability, reasonCode, missingRequirements };
  } catch { throw new AssistantError("Nuk u verifikua gatishmëria. Nuk do të bëhet ndryshim pa një kontroll të ri."); }
}

function blocker(assessment: CapabilityAssessment, actor: Actor): CatalogActivationResult | null {
  const base = { assessment, changed: false };
  if (assessment.availability === "module_disabled" || assessment.missingRequirements.includes("module:products"))
    return { ...base, status: "disabled", message: "Moduli Produkte është i çaktivizuar ose nuk lejohet nga paketa. Ky dialog nuk ndryshon modulet ose lejet." };
  if (assessment.status === "ready") return { ...base, status: "ready", message: "Kërkimi i produkteve është tashmë gati. Nuk nevojitet ndryshim." };
  if (actor.catalogSource === "external") return { ...base, status: "blocked", message: "Ky katalog menaxhohet nga një burim i jashtëm; nuk mund të aktivizohet nga ky dialog." };
  if (assessment.status !== "needs_setup" || assessment.missingRequirements.length !== 1 || assessment.missingRequirements[0] !== "active_products")
    return { ...base, status: "blocked", message: "Ky konfigurim kërkon verifikim tjetër. Nuk ofrohet anashkalim nga plani." };
  return null;
}

export async function inspectCatalogActivation(actor: Actor, key: unknown): Promise<CatalogActivationResult> {
  if (key !== capability) return { status: typeof key === "string" && getCapability(key) ? "blocked" : "unsupported", changed: false,
    message: "Ky dialog konfiguron vetëm kërkimin e produkteve. Nuk aktivizon aftësi të tjera ose të pambështetura." };
  if (!await canConfigure(actor)) return { status: "unauthorized", changed: false, message: "Vetëm pronari ose administratori mund ta miratojë këtë konfigurim." };
  const assessment = await assess(actor);
  const blocked = blocker(assessment, actor);
  if (blocked) return blocked;
  const { data, error } = await createServiceSupabase().from("products").select(productCatalogColumns)
    .eq("business_id", actor.businessId).eq("is_active", false).order("name").limit(21);
  if (error) throw new AssistantError("Produktet nuk u lexuan. Provo përsëri.");
  const options: NonNullable<CatalogActivationResult["options"]> = await Promise.all(((data ?? []) as ProductRow[]).slice(0, 20).map(async product => {
    let problem: string | undefined;
    try {
      await requireCatalogActivation(actor.businessId, [product]);
      if (!product.updated_at || !Number.isFinite(Date.parse(product.updated_at))) throw new Error("Rifresko produktin; versioni i tij nuk u verifikua.");
      if (product.workflow_id) {
        const linked = await createServiceSupabase().from("workflows").select("id").eq("business_id", actor.businessId).eq("id", product.workflow_id).maybeSingle();
        if (linked.error || !linked.data) throw new Error("Lidhja ekzistuese e produktit nuk u verifikua. Korrigjoje para aktivizimit.");
      }
    } catch { problem = "Produkti nuk u verifikua për aktivizim. Duhen çmim, monedhë, lloj aktiv dhe lidhje të vlefshme. Rifresko konfigurimin nëse këto janë plotësuar."; }
    const ticket: Ticket = { purpose: "assistant-catalog-activation-v1", capability, userId: actor.userId, businessId: actor.businessId,
      productId: product.id, updatedAt: product.updated_at ?? "", expires: Date.now() + 10 * 60000 };
    return { id: product.id, name: product.name, price: product.price_amount, currency: product.currency,
      ...(problem ? { blocker: problem } : { token: encryptSecret(JSON.stringify(ticket)) }) };
  }));
  return { status: options.some(o => o.token) ? "available" : "blocked", changed: false, assessment, options, partial: (data?.length ?? 0) > 20,
    message: options.some(o => o.token) ? "Zgjidh një produkt në draft për ta bërë të kërkueshëm. Do të ndryshojë vetëm statusi i tij në katalog." :
      "Nuk u gjet produkt draft i gatshëm. Nevojitet një produkt me çmim, monedhë dhe lloj aktiv; ky hap nuk krijon produkte ose ndryshon të dhënat e tyre." };
}

function openActivation(token: unknown, actor: Actor): Ticket {
  try {
    if (typeof token !== "string" || token.length > 8000) throw Error();
    const t = JSON.parse(decryptSecret(token)) as Ticket;
    if (t.purpose !== "assistant-catalog-activation-v1" || t.capability !== capability || t.userId !== actor.userId || t.businessId !== actor.businessId ||
      !uuid(t.productId) || typeof t.updatedAt !== "string" || !Number.isFinite(Date.parse(t.updatedAt)) || !Number.isFinite(t.expires) || t.expires <= Date.now()) throw Error();
    return t;
  } catch { throw new AssistantError("Miratimi ka skaduar, është i pavlefshëm ose i përket një përdoruesi/biznesi tjetër. Rihap konfigurimin."); }
}

export async function confirmCatalogActivation(actor: Actor, token: unknown): Promise<CatalogActivationResult> {
  const ticket = openActivation(token, actor);
  if (!await canConfigure(actor)) return { status: "unauthorized", changed: false, message: "Leja për konfigurim nuk është më e vlefshme. Nuk u bë ndryshim." };
  const before = await assess(actor);
  const blocked = blocker(before, actor);
  if (blocked) return blocked; // Also makes a repeated approval read-only once ready.
  const current = await createServiceSupabase().from("products").select("id,is_active,updated_at")
    .eq("business_id", actor.businessId).eq("id", ticket.productId).maybeSingle();
  if (current.error) throw new AssistantError("Produkti nuk u verifikua. Nuk u bë ndryshim.");
  if (!current.data || current.data.updated_at !== ticket.updatedAt || current.data.is_active)
    throw new AssistantError("Produkti ka ndryshuar ose është hequr. Rihap konfigurimin dhe shqyrto versionin e ri.");
  let saved: Awaited<ReturnType<typeof updateCatalogField>>;
  try {
    // Existing action reauthenticates, validates catalog requirements/references and
    // atomically fences this exact tenant-owned row with updated_at.
    saved = await updateCatalogField(actor.slug, { id: ticket.productId, field: "is_active", value: true, updatedAt: ticket.updatedAt });
  } catch {
    return { status: "unverified", changed: null, message: "Rezultati i ruajtjes nuk u konfirmua. Mund të jetë ruajtur; rihap kontrollin përpara riprovimit." };
  }
  if (saved.error || !saved.product?.is_active) throw new AssistantError(saved.error ?? "Aktivizimi nuk u konfirmua. Rihap kontrollin.");
  try {
    const assessment = await assess(actor);
    return { status: assessment.status === "ready" ? "activated" : "unverified", changed: true, assessment,
      message: assessment.status === "ready" ? "Produkti u aktivizua në katalog dhe kërkimi u rivlerësua si gati. Nuk u krijua porosi dhe nuk u publikua workflow." :
        "Produkti u aktivizua, por aftësia ende nuk është gati. Kontrollo konfigurimin aktual përpara se të vazhdosh." };
  } catch {
    return { status: "unverified", changed: true, message: "Produkti u aktivizua, por rivlerësimi dështoi. Rihap kontrollin; mos e trajto aftësinë si gati." };
  }
}
