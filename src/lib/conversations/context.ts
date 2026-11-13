import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto/tokens";
import { readProcessProfile } from "@/lib/conversations/profile";
import type { Field, Snapshot, Value } from "@/lib/orchestration/contracts";
import { compileProcessVersion, loadProcessVersion } from "@/lib/orchestration/version-store";
import { statusLabels as leadStatusLabels, type LeadStatus } from "@/lib/leads/model";
import { loadThreadConversation } from "./inbox-read";
import { runtimeModules } from "@/lib/capabilities/enforcement";

/**
 * Everything the business already knows about one conversation, read in one
 * place for the web Inbox and the native app. Read-only: actions keep their own
 * routes and server checks. Every query is scoped to this business.
 */
export type ConversationContext = {
  conversation: { id: string; name: string; handle: string; channel: string; status: string };
  /** What the agent collected about the person (validated values only). */
  profile: { name: string | null; phone: string | null; email: string | null; city: string | null; address: string | null };
  customer: { linked: boolean; name: string | null; phone: string | null; since: string | null };
  handoffRequested: boolean;
  processes: {
    id: string;
    name: string;
    status: string;
    statusLabel: string;
    fields: { label: string; value: string }[];
    missing: string[];
  }[];
  /** An order the agent prepared that waits for staff confirmation. */
  pendingOrder: { process: string } | null;
  orders: { id: string; status: string; statusLabel: string; total: number | null; currency: string | null; createdAt: string }[];
  bookings: { id: string; service: string; startsAt: string; status: string; statusLabel: string }[];
  lead: { id: string; status: LeadStatus; statusLabel: string; interest: string } | null;
  /** Agjenti.app only: the invitation sent to this prospect and what was collected for it. */
  invitation: {
    status: string;
    statusLabel: string;
    url: string | null;
    email: string;
    businessName: string | null;
    description: string | null;
    instagram: string | null;
    expiresAt: string;
    acceptedAt: string | null;
    createdAt: string;
  } | null;
  prospectScans: { username: string; status: string; statusLabel: string; posts: number; fetchedAt: string | null }[];
  /** What the owner's "Krijo porosi" and "Cakto takim" forms start from. */
  forms: {
    order: { enabled: boolean; productId: string | null; productName: string | null; quantity: number };
    booking: { enabled: boolean; services: { id: string; name: string }[]; serviceId: string | null; date: string | null; time: string | null };
  };
};

const processStatusLabels: Record<string, string> = {
  running: "Në proces",
  waiting_input: "Pret të dhëna nga klienti",
  waiting_approval: "Pret konfirmimin e klientit",
  waiting_event: "Në pritje",
  waiting_effect: "Duke u ekzekutuar",
  suspended: "E pezulluar",
  handoff: "Kërkon njeri",
  completed: "Përfunduar",
  cancelled: "Anuluar",
  failed: "Dështoi",
};
const orderStatusLabels: Record<string, string> = {
  draft: "Draft",
  confirmed: "E konfirmuar",
  submitted: "E dërguar",
  failed: "Dështoi",
  pending_reconciliation: "Pret kontroll",
  accepted: "E pranuar",
  rejected: "E refuzuar",
};
const bookingStatusLabels: Record<string, string> = { pending: "Në pritje", confirmed: "E konfirmuar", cancelled: "Anuluar" };
const invitationStatusLabels: Record<string, string> = { pending: "Dërguar, pa u pranuar", accepted: "E pranuar", revoked: "E anuluar", expired: "Ka skaduar" };
const scanStatusLabels: Record<string, string> = { queued: "Në radhë", running: "Duke u lexuar", ready: "Gati", not_found: "Nuk u gjet", failed: "Dështoi" };

const label = (labels: Record<string, string>, key: string) => labels[key] ?? key;

/**
 * Built-in order and booking fields carry technical labels; show them in the
 * owner's words, and hide identifiers and settings. null = never shown.
 */
const systemFields: Record<string, { label: string | null; missing?: string }> = {
  productId: { label: null, missing: "Produkti" },
  productName: { label: "Produkti" },
  productTypeId: { label: null },
  unitAmount: { label: "Çmimi për njësi" },
  currency: { label: null },
  quantity: { label: "Sasia" },
  options: { label: null },
  serviceId: { label: null, missing: "Shërbimi" },
  serviceName: { label: "Shërbimi" },
  date: { label: "Data" },
  time: { label: "Ora" },
  name: { label: "Emri" },
  contact: { label: "Kontakti" },
  durationMinutes: { label: null },
  bufferMinutes: { label: null },
  timezone: { label: null },
  confirmationMode: { label: null },
};
const customerFields: Record<string, string> = { name: "Emri", phone: "Telefoni", email: "Email", city: "Qyteti", address: "Adresa" };

/** The owner-facing label of a field, null to hide it, and the label to list when it is missing. */
export function fieldPresentation(field: Field): { label: string | null; missing: string | null } {
  const customer = /^customer_([a-z]+)$/.exec(field.id);
  if (customer) {
    const label = customerFields[customer[1]] ?? field.label;
    return { label, missing: label };
  }
  const system = /^(?:order|booking)_[0-9a-f]{16}_([A-Za-z]+)$/.exec(field.id);
  if (system) {
    const spec = systemFields[system[1]] ?? { label: null };
    return { label: spec.label, missing: field.source === "server" ? null : spec.missing ?? spec.label };
  }
  if (field.source === "server" || field.type === "reference" || field.type === "photo") return { label: null, missing: null };
  return { label: field.label, missing: field.label };
}

function display(value: Value): string | null {
  if (typeof value === "boolean") return value ? "Po" : "Jo";
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  const text = String(value).trim();
  return text ? text.slice(0, 300) : null;
}

function text(value: unknown, max = 500) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Null when the conversation is not in this business. */
export async function loadConversationContext(db: SupabaseClient, businessId: string, conversationId: string): Promise<ConversationContext | null> {
  const conversation = await loadThreadConversation(db, businessId, conversationId);
  if (!conversation) return null;
  const [identity, state, orders, effects, lead, executions, scans] = await Promise.all([
    db.from("conversations").select("instagram_participant_id,whatsapp_participant_id")
      .eq("business_id", businessId).eq("id", conversationId).maybeSingle(),
    db.from("conversation_states").select("collected").eq("business_id", businessId).eq("conversation_id", conversationId).maybeSingle(),
    conversation.customer_id
      ? db.from("orders").select("id,status,total_amount,currency,created_at").eq("business_id", businessId)
          .or(`conversation_id.eq.${conversationId},customer_id.eq.${conversation.customer_id}`).order("created_at", { ascending: false }).limit(10)
      : db.from("orders").select("id,status,total_amount,currency,created_at").eq("business_id", businessId)
          .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10),
    db.from("workflow_booking_effects").select("booking_id").eq("business_id", businessId).eq("conversation_id", conversationId).limit(20),
    db.from("leads").select("id,status,interest,updated_at").eq("business_id", businessId).eq("conversation_id", conversationId)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("action_executions").select("id").eq("business_id", businessId).eq("action_key", "business.provision")
      .eq("conversation_id", conversationId).eq("status", "succeeded").order("created_at", { ascending: false }).limit(5),
    db.from("prospect_scans").select("username,status,posts,fetched_at").eq("business_id", businessId)
      .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(5),
  ]);
  for (const result of [identity, state, orders, effects, lead, executions, scans])
    if (result.error) throw new Error("conversation_context_unavailable");

  const snapshot = (state.data?.collected ?? null) as Partial<Snapshot> | null;
  const live = snapshot?.schemaVersion === 4 && snapshot.businessId === businessId && snapshot.conversationId === conversationId ? snapshot : null;

  // Profile: the shared per-person memory, else the copy in this conversation's state.
  const participant = conversation.channel === "whatsapp" ? identity.data?.whatsapp_participant_id : identity.data?.instagram_participant_id;
  // The remaining reads only need the first batch; run them together.
  const instances = Object.values(live?.instances ?? {});
  const versions = new Map<string, ReturnType<typeof compileProcessVersion>>();
  const bookingIds = (effects.data ?? []).map((row) => row.booking_id);
  const bookingColumns = "id,service_name,starts_at,status";
  const executionIds = (executions.data ?? []).map((row) => row.id);
  const [savedMemory, , [byEffect, byConversation], [modules, services], invitations] = await Promise.all([
    participant
      ? readProcessProfile(businessId, participant, conversation.channel === "whatsapp" ? "whatsapp" : "instagram").catch(() => undefined)
      : Promise.resolve(undefined),
    Promise.all([...new Set(instances.map((i) => i.versionId))].map(async (versionId) => {
      const version = await loadProcessVersion(businessId, versionId).catch(() => null);
      if (version) versions.set(versionId, compileProcessVersion(version));
    })),
    Promise.all([
      bookingIds.length
        ? db.from("bookings").select(bookingColumns).eq("business_id", businessId).in("id", bookingIds)
        : Promise.resolve({ data: [] as { id: string; service_name: string; starts_at: string; status: string }[], error: null }),
      db.from("bookings").select(bookingColumns).eq("business_id", businessId).eq("conversation_id", conversationId).limit(20),
    ]),
    runtimeModules(businessId).catch(() => [] as string[]).then(async (modules) => {
      const allowed = modules === null || ["bookings", "services"].every((key) => modules.includes(key));
      const services = allowed
        ? await db.from("booking_services").select("id,name").eq("business_id", businessId).eq("is_active", true).eq("booking_enabled", true).order("name").limit(100)
        : { data: [] as { id: string; name: string }[], error: null };
      return [modules, services] as const;
    }),
    executionIds.length
      ? db.from("business_invitations").select("email,details,status,expires_at,accepted_at,created_at,token_ciphertext")
          .eq("source_business_id", businessId).in("execution_id", executionIds).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const memory = savedMemory ?? live?.profileMemory ?? {};
  const profile = {
    name: memory.name?.value ?? null,
    phone: memory.phone?.value ?? null,
    email: memory.email?.value ?? null,
    city: memory.city?.value ?? null,
    address: memory.address?.value ?? null,
  };

  // Processes: field labels come from the pinned version the instance runs on.
  let pendingOrder: ConversationContext["pendingOrder"] = null;
  // Latest values the agent collected for the built-in order and booking fields.
  const collectedSystem: Record<string, string | number> = {};
  for (const instance of instances)
    for (const [id, fact] of Object.entries(instance.facts ?? {})) {
      const match = /^(?:order|booking)_[0-9a-f]{16}_([A-Za-z]+)$/.exec(id);
      if (match && (typeof fact.value === "string" || typeof fact.value === "number")) collectedSystem[match[1]] = fact.value;
    }
  const processes = instances
    .filter((instance) => instance.status !== "cancelled")
    .map((instance) => {
      const definition = versions.get(instance.versionId)?.find((d) => d.id === instance.definitionId);
      const fields: { label: string; value: string }[] = [];
      const missing: string[] = [];
      for (const field of definition?.fields ?? []) {
        const presentation = fieldPresentation(field);
        const fact = instance.facts[field.id];
        const value = fact && presentation.label ? display(fact.value) : null;
        if (value && presentation.label) fields.push({ label: presentation.label, value });
        else if (!fact && field.required && presentation.missing && !instance.skippedFields?.[field.id] && !missing.includes(presentation.missing)
          // The runtime fills customer fields from the person's saved profile.
          && !memory[field.id.replace(/^customer_/, "") as keyof typeof memory])
          missing.push(presentation.missing);
      }
      const name = definition?.name ?? "Proces";
      if (instance.action?.tool === "order.create" && instance.action.output?.submissionStatus === "awaiting_staff") pendingOrder = { process: name };
      return {
        id: instance.id,
        name,
        status: instance.status,
        statusLabel: label(processStatusLabels, instance.status),
        fields,
        missing: instance.status === "completed" ? [] : missing,
      };
    });

  // Agent bookings (through their workflow effect) and bookings the owner made from this conversation.
  const bookingRows = new Map([...(byEffect.data ?? []), ...(byConversation.data ?? [])].map((row) => [row.id, row]));
  const bookings = {
    error: byEffect.error ?? byConversation.error,
    data: [...bookingRows.values()].sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
  };
  if (bookings.error) throw new Error("conversation_context_unavailable");

  const allowed = (...keys: string[]) => modules === null || keys.every((key) => modules.includes(key));
  const bookingEnabled = allowed("bookings", "services");
  if (services.error) throw new Error("conversation_context_unavailable");
  const text36 = (value: unknown) => (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null);
  const quantity = Number(collectedSystem.quantity);
  const forms: ConversationContext["forms"] = {
    order: {
      enabled: allowed("orders", "products"),
      productId: text36(collectedSystem.productId),
      productName: typeof collectedSystem.productName === "string" ? collectedSystem.productName : null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    },
    booking: {
      enabled: bookingEnabled,
      services: services.data ?? [],
      serviceId: text36(collectedSystem.serviceId),
      date: typeof collectedSystem.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(collectedSystem.date) ? collectedSystem.date : null,
      time: typeof collectedSystem.time === "string" && /^\d{2}:\d{2}$/.test(collectedSystem.time) ? collectedSystem.time : null,
    },
  };

  if (invitations.error) throw new Error("conversation_context_unavailable");
  const invite = invitations.data?.[0];
  let invitation: ConversationContext["invitation"] = null;
  if (invite) {
    const expired = invite.status === "pending" && Date.parse(invite.expires_at) <= Date.now();
    const status = expired ? "expired" : invite.status;
    let url: string | null = null;
    if (status === "pending") {
      try {
        url = `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? ""}/join?request=${decryptSecret(invite.token_ciphertext)}`;
      } catch {
        url = null;
      }
    }
    const details = (invite.details ?? {}) as Record<string, unknown>;
    invitation = {
      status,
      statusLabel: label(invitationStatusLabels, status),
      url,
      email: invite.email,
      businessName: text(details.name, 200),
      description: text(details.description, 1000),
      instagram: text(details.instagramUsername, 60),
      expiresAt: invite.expires_at,
      acceptedAt: invite.accepted_at,
      createdAt: invite.created_at,
    };
  }

  const leadRow = lead.data;
  return {
    conversation: { id: conversation.id, name: conversation.name, handle: conversation.handle, channel: conversation.channel, status: conversation.status },
    profile,
    customer: {
      linked: Boolean(conversation.customer),
      name: conversation.customer?.display_name || null,
      phone: conversation.customer?.phone ?? null,
      since: conversation.customer?.created_at ?? null,
    },
    handoffRequested: live?.handoffRequested === true,
    processes,
    pendingOrder,
    orders: (orders.data ?? []).map((order) => ({
      id: order.id,
      status: order.status,
      statusLabel: label(orderStatusLabels, order.status),
      total: order.total_amount,
      currency: order.currency,
      createdAt: order.created_at,
    })),
    bookings: (bookings.data ?? []).map((booking) => ({
      id: booking.id,
      service: booking.service_name,
      startsAt: booking.starts_at,
      status: booking.status,
      statusLabel: label(bookingStatusLabels, booking.status),
    })),
    lead: leadRow
      ? { id: leadRow.id, status: leadRow.status as LeadStatus, statusLabel: leadStatusLabels[leadRow.status as LeadStatus] ?? leadRow.status, interest: leadRow.interest ?? "" }
      : null,
    invitation,
    prospectScans: (scans.data ?? []).map((scan) => ({
      username: scan.username,
      status: scan.status,
      statusLabel: label(scanStatusLabels, scan.status),
      posts: Array.isArray(scan.posts) ? scan.posts.length : 0,
      fetchedAt: scan.fetched_at,
    })),
    forms,
  };
}
