import { createServiceSupabase } from "@/lib/supabase/service";
import { foldText, type ConversationStatePayload } from "@/lib/workflows/engine";

/** The inbound adapter supplies these values from the verified webhook, never customer text. */
export type OrderCustomerIdentity = {
  conversationId: string;
  instagramParticipantId: string;
  instagramConnectionId: string;
};
type OrderSummary = { id: string; status: string; created_at: string };
export type OrderStatusLookup = { references: { id: string; reference: string }[]; createdAt: number; visual?: ConversationStatePayload["visual"] };
const lookupKey = "order_status_lookup";
const lifetime = 15 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderStatusRequest(message: string): boolean {
  const text = foldText(message);
  const order = /\b(porosi\w*|order\w*|pako\w*|package|parcel)\b/.test(text);
  return order && /\b(status\w*|gjurm\w*|track\w*|ku (?:eshte|ndodhet|e kam|ka shkuar)|where|kur (?:vjen|mberrin|arrin|do (?:te )?vi\w*)|when.*(?:arrive|deliver)|a (?:ka|eshte|u) (?:ardh\w*|nis\w*|dergu\w*|mberri\w*)|kontrollo\w*|check|mb(?:e|a)rritur|delivery|shipping update|cfare po behet)\b/.test(text);
}

export function readOrderStatusLookup(state?: ConversationStatePayload | null, includeExpired = false): OrderStatusLookup | undefined {
  const raw = state?.fields[lookupKey] as OrderStatusLookup | undefined;
  if (!raw || !Number.isFinite(raw.createdAt) || (!includeExpired && Date.now() - raw.createdAt > lifetime) || raw.createdAt > Date.now() + 60000 || !Array.isArray(raw.references) || raw.references.length > 5 || !raw.references.length) return;
  if (!raw.references.every(item => item && uuid.test(item.id) && typeof item.reference === "string" && /^[A-F0-9]{8,32}$/.test(item.reference))) return;
  return raw;
}

export function isOrderStatusFollowUp(message: string, state?: ConversationStatePayload | null): boolean {
  // Expiry invalidates the old mapping, not ownership of the last question: a bare
  // number must refresh this list rather than fill a previously pending order field.
  if (!readOrderStatusLookup(state, true)) return false;
  return /^(?:porosia\s*|order\s*|nr\.?\s*)?#?[a-f0-9-]{1,36}[.!\s]*$/i.test(foldText(message)) || /^(?:po|jo|yes|no|e para|e dyta|e treta|e katerta|e pesta|first|second|third|latest|e fundit)[.!\s]*$/.test(foldText(message));
}

export function setOrderStatusLookup(state: ConversationStatePayload, lookup?: OrderStatusLookup) {
  if (lookup) state.fields[lookupKey] = lookup;
  else delete state.fields[lookupKey];
}

function references(orders: OrderSummary[]) {
  return orders.map(order => {
    const compact = order.id.replaceAll("-", "").toUpperCase();
    let length = 8;
    while (length < compact.length && orders.some(other => other.id !== order.id && other.id.replaceAll("-", "").toUpperCase().slice(0, length) === compact.slice(0, length))) length += 4;
    return { id: order.id, reference: compact.slice(0, length) };
  });
}
function selectReference(message: string, lookup: OrderStatusLookup | undefined) {
  if (!lookup) return;
  const text = foldText(message).replace(/[.!\s]+$/, "");
  const ordinal = ["e para", "e dyta", "e treta", "e katerta", "e pesta"].indexOf(text);
  const english = ["first", "second", "third"].indexOf(text);
  const index = ordinal >= 0 ? ordinal : english >= 0 ? english : /^\d$/.test(text) ? Number(text) - 1 : ["latest", "e fundit"].includes(text) ? 0 : -1;
  if (index >= 0) return lookup.references[index]?.id;
  const token = text.replace(/^(?:porosia\s*|order\s*|nr\.?\s*)?#?/, "").replaceAll("-", "").toUpperCase();
  return lookup.references.find(item => item.reference === token || item.id.replaceAll("-", "").toUpperCase() === token)?.id;
}
function describe(order: OrderSummary, reference: string) {
  const status: Record<string, string> = {
    draft: "është ruajtur si draft dhe ende nuk është konfirmuar.",
    confirmed: "është konfirmuar në sistem.",
    submitted: "është dërguar te sistemi i porosive. Ky status nuk konfirmon nisjen apo dorëzimin e pakos.",
    failed: "ka një problem me dërgimin te sistemi i porosive. Stafi duhet ta kontrollojë; kjo nuk do të thotë që porosia është anuluar.",
  };
  return `Porosia #${reference} ${status[order.status] ?? "ka një status që nuk mund ta shpjegoj me siguri; kontakto stafin."} Nuk kam informacion të verifikuar për vendndodhjen e pakos ose datën e dorëzimit.`;
}

/** Read only: the query never accepts a customer ID or order ID as an authorization boundary. */
async function ownOrders(businessId: string, identity: OrderCustomerIdentity): Promise<OrderSummary[] | null> {
  const db = createServiceSupabase();
  const { data: conversation, error: identityError } = await db.from("conversations").select("id,customer_id")
    .eq("business_id", businessId).eq("id", identity.conversationId)
    .eq("instagram_participant_id", identity.instagramParticipantId).eq("instagram_connection_id", identity.instagramConnectionId).maybeSingle();
  if (identityError) throw new Error("order_status_unavailable");
  if (!conversation) return null;
  const [{ data: conversations, error: conversationsError }, { data: customer, error: customerError }] = await Promise.all([
    db.from("conversations").select("id").eq("business_id", businessId)
      .eq("instagram_participant_id", identity.instagramParticipantId).eq("instagram_connection_id", identity.instagramConnectionId)
      .order("created_at", { ascending: false }).limit(100),
    db.from("customers").select("id").eq("business_id", businessId).eq("instagram_user_id", identity.instagramParticipantId).maybeSingle(),
  ]);
  if (conversationsError || customerError) throw new Error("order_status_unavailable");
  const ids = [...new Set([conversation.id, ...(conversations ?? []).map(item => item.id)])];
  const scoped = db.from("orders").select("id,status,created_at").eq("business_id", businessId);
  const results = await Promise.all([
    scoped.in("conversation_id", ids).order("created_at", { ascending: false }).limit(6),
    customer ? db.from("orders").select("id,status,created_at").eq("business_id", businessId).eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(6) : Promise.resolve({ data: [], error: null }),
  ]);
  if (results.some(result => result.error)) throw new Error("order_status_unavailable");
  const orders = new Map<string, OrderSummary>();
  for (const result of results) for (const order of result.data ?? []) orders.set(order.id, order);
  return [...orders.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);
}

export async function customerOrderStatus(params: { businessId: string; message: string; state: ConversationStatePayload; identity?: OrderCustomerIdentity; isolated?: boolean }) {
  const nextState = structuredClone(params.state);
  const lookup = readOrderStatusLookup(params.state);
  const expiredLookup = !lookup && Boolean(readOrderStatusLookup(params.state, true));
  const reply = (text: string, pending = false) => ({ reply: text, nextState, pending });
  if (params.isolated) {
    setOrderStatusLookup(nextState);
    return reply("Kjo është një provë: nuk lexoj porosi reale të klientëve. Në Instagram do të kontrolloj vetëm porositë e lidhura me llogarinë e klientit dhe do të raportoj statusin e ruajtur.");
  }
  if (!params.identity?.conversationId || !params.identity.instagramParticipantId || !params.identity.instagramConnectionId) {
    setOrderStatusLookup(nextState);
    return reply("Nuk mund ta verifikoj llogarinë për kontrollin e porosisë. Kontakto stafin nga biseda ku ke bërë porosinë.");
  }
  try {
    const orders = await ownOrders(params.businessId, params.identity);
    if (!orders) { setOrderStatusLookup(nextState); return reply("Nuk mund ta verifikoj llogarinë për kontrollin e porosisë. Kontakto stafin."); }
    if (!orders.length) { setOrderStatusLookup(nextState); return reply("Nuk gjeta porosi të regjistruara të lidhura me këtë llogari Instagram. Stafi mund ta kontrollojë kërkesën tënde."); }
    const explicitReference = params.message.match(/#([a-f0-9-]{8,36})\b|\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/i);
    const requestedReference = explicitReference?.[1] ?? explicitReference?.[2];
    const selectedId = requestedReference ? selectReference(requestedReference, { references: references(orders), createdAt: Date.now() }) : selectReference(params.message, lookup);
    const selected = selectedId ? orders.find(order => order.id === selectedId) : !lookup && !expiredLookup && !requestedReference && orders.length === 1 ? orders[0] : undefined;
    if (selected) {
      setOrderStatusLookup(nextState);
      return reply(describe(selected, references(orders).find(item => item.id === selected.id)!.reference));
    }
    const visible = orders.slice(0, 5);
    const current = { references: references(visible), createdAt: Date.now() };
    setOrderStatusLookup(nextState, current);
    const options = visible.map((order, i) => `${i + 1}. #${current.references[i].reference} · ${new Date(order.created_at).toLocaleDateString("sq-AL", { timeZone: "Europe/Tirane" })}`);
    return reply(`${expiredLookup ? "Lista e mëparshme ka skaduar; zgjidh nga lista e përditësuar. " : ""}${selectedId || requestedReference ? "Nuk e gjeta atë porosi në listën aktuale të kësaj llogarie. " : ""}${orders.length > 5 ? "Këto janë 5 porositë më të fundit." : "Cilën porosi dëshiron të kontrolloj?"}\n${options.join("\n")}\nShkruaj numrin në listë ose referencën e shkurtër.`, true);
  } catch {
    // Preserve the current selection on transient read errors, never claim no order exists.
    return reply("Nuk arrita ta kontrolloj statusin tani. Provo përsëri ose kontakto stafin.", Boolean(lookup));
  }
}
