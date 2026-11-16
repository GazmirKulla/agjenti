export type CampaignInput = { name: string; channel: "instagram" | "whatsapp"; body: string; terms: string; offerExpiresAt: string | null; hours: number; orders: "all" | "with" | "without" | "30" | "90"; lead: string | null; maxRecipients: number; testConversationId?: string };
export const FOOTER = "Shkruaj STOP që të mos marrësh më oferta.";
export function parseCampaign(value: unknown): CampaignInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_input");
  const v = value as Record<string, unknown>;
  const text = (key: string, max: number, optional = false) => {
    if (typeof v[key] !== "string" || (!optional && !String(v[key]).trim()) || String(v[key]).length > max) throw new Error("invalid_input");
    return String(v[key]).trim();
  };
  if (v.channel !== "instagram" && v.channel !== "whatsapp") throw new Error("invalid_input");
  if (!Number.isInteger(v.hours) || Number(v.hours) < 1 || Number(v.hours) > 23 || !Number.isInteger(v.maxRecipients) || Number(v.maxRecipients) < 1 || Number(v.maxRecipients) > 500) throw new Error("invalid_input");
  if (!["all", "with", "without", "30", "90"].some(x => x === v.orders) || v.lead !== null && !["new", "contacted", "won", "lost"].some(x => x === v.lead)) throw new Error("invalid_input");
  if (v.offerExpiresAt !== null && (typeof v.offerExpiresAt !== "string" || !Number.isFinite(Date.parse(v.offerExpiresAt)) || Date.parse(v.offerExpiresAt) <= Date.now())) throw new Error("offer_expired");
  if (v.testConversationId !== undefined && (typeof v.testConversationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.testConversationId))) throw new Error("invalid_input");
  const body = text("body", 1000), terms = text("terms", 1000, true);
  // Template syntax is a deterministic format contract, never language interpretation.
  for (const token of `${body} ${terms}`.matchAll(/\{\{([^{}]+)\}\}/g)) if (token[1] !== "emri" && token[1] !== "biznesi") throw new Error("invalid_variable");
  return { name: text("name", 120), channel: v.channel, body, terms, offerExpiresAt: v.offerExpiresAt as string | null, hours: Number(v.hours), orders: v.orders as CampaignInput["orders"], lead: v.lead as string | null, maxRecipients: v.testConversationId ? 1 : Number(v.maxRecipients), ...(v.testConversationId ? { testConversationId: String(v.testConversationId) } : {}) };
}
export const reasonLabels: Record<string, string> = {
  token_revoked: "Token-i i kanalit është revokuar. Rilidh kanalin përpara vazhdimit.", rate_limited: "Kanali kërkon pauzë. Provo të vazhdosh më vonë.",
  worker_unavailable: "Vazhdimi automatik nuk është konfiguruar. Dërgimi nuk nisi.", worker_limit: "Procesi u pezullua pas pritjes së gjatë. Mund të vazhdosh marrësit në pritje.",
  no_consent: "Pa pëlqim për oferta", unsubscribed: "I çregjistruar", review_pending: "Pëlqimi pret sqarim", frequency: "Ka marrë një fushatë së fundmi", window_closed: "Dritarja ka mbaruar", disconnected: "Kanali është shkëputur", archived: "Klient i arkivuar", no_inbound: "Pa mesazh nga klienti", orders_filter: "Jashtë filtrit të porosive", lead_filter: "Jashtë filtrit të lead-it", quiet_hours: "Jashtë orarit 09:00–21:00", offer_expired: "Oferta ka skaduar", campaign_expired: "Fushata ka skaduar", identity_changed: "Kontakti ka ndryshuar", cancelled: "Fushata u anulua", owner_cancelled: "Anuluar nga pronari", owner_paused: "Pezulluar nga pronari", quota: "Kuota është mbaruar", globally_disabled: "Dërgimi nuk është aktivizuar nga platforma", authorization_changed: "Qasja ose cilësimet kanë ndryshuar", uncertain: "Rezultati kërkon verifikim; nuk ridërgohet", failure_rate: "Shumë dërgime kanë dështuar", worker_interrupted: "Dërgimi u ndërpre; rezultati është i panjohur", provider_failed: "Kanali refuzoi dërgimin", preview_expired: "Pamja paraprake skadoi. Krijoje përsëri.", rendered_message_too_long: "Mesazhi me emrin, kushtet dhe fundin tejkalon kufirin e kanalit.", owner_required: "Vetëm pronari mund ta kryejë këtë veprim.", disabled: "Aktivizo fushatat te cilësimet më poshtë.", invalid_transition: "Gjendja ka ndryshuar. Rifresko faqen.", invalid_variable: "Lejohen vetëm {{emri}} dhe {{biznesi}}.", audience_changed: "Lista nuk përputhet me konfirmimin.", recipient_limit: "Lejohen 1–500 marrës.", invalid_input: "Kontrollo fushat e formularit.", invalid_timezone: "Zona kohore nuk është e vlefshme.",
};
export const statusLabels: Record<string, string> = { draft: "Draft", running: "Duke dërguar", paused: "Pezulluar", cancelled: "Anuluar", completed: "Përfunduar", pending: "Në pritje", sending: "Duke dërguar", sent: "Pranuar nga kanali", delivered: "Dorëzuar", read: "Lexuar", failed: "Dështoi", uncertain: "E panjohur", skipped: "Kapërcyer" };
