import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import type { AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import { agentModel } from "@/lib/agents/generate";
import {
  emptyState,
  foldText,
  type ConversationStatePayload,
} from "@/lib/workflows/engine";
import type { TraceObserver } from "@/lib/conversations/trace";
import {
  defaultSettings,
  localInstant,
  validDate,
  validTime,
  zonedParts,
  type BookingService,
  type CalendarSettings,
} from "./model";
import { availableSlots, persistBooking, type BookingEffectGuard } from "./service";
import { extractBookingDetails } from "./agent-parser";
import { loadVisualVersion } from "@/lib/workflows/visual/store";
export type BookingDraft = {
  serviceId?: string;
  date?: string;
  time?: string;
  name?: string;
  contact?: string;
  phase: "collect" | "confirm";
  nonce: string;
  expires: number;
};
export function explicitBookingConfirmation(message: string) {
  return /^(po|po konfirmoj|konfirmoj|yes|confirm)[.!]?$/i.test(message.trim());
}
/** Separate action adapter. The shared AI/order core remains read-only. Test mode never creates bookings or Google events. */
export async function processBookingTurn(params: {
  businessId: string;
  message: string;
  state?: ConversationStatePayload | null;
  mode?: "production" | "test";
  conversationKey?: string;
  onTrace?: TraceObserver;
  routed?: boolean;
  resume?: boolean;
  bookingGuard?: BookingEffectGuard;
  canAct?: () => Promise<boolean>;
}): Promise<AgentTurnResult | null> {
  const existingState = structuredClone(params.state ?? emptyState());
  if (!params.routed && existingState.product_id) return null;
  // Published visual rules own routing; booking cannot bypass a collect/confirm or handoff.
  if (!params.routed && existingState.visual && existingState.visual.status !== "completed") return null;
  const raw = existingState.fields.booking as BookingDraft | undefined;
  if (
    !params.routed && !raw &&
    !/rezerv|takim|appointment|booking|termin|orare?\s+(?:te|të)\s+lir/i.test(
      foldText(params.message),
    )
  )
    return null;
  const profile = await loadDashboardProfile(params.businessId);
  if (!profile.enabledModules.includes("bookings")) return null;
  // Finish reservations already in progress, but let new runs follow the published graph.
  if (!params.routed && !raw && await loadVisualVersion(params.businessId)) return null;
  const db = createServiceSupabase();
  const [cfg, services] = await Promise.all([
    db
      .from("business_calendar_settings")
      .select("*")
      .eq("business_id", params.businessId)
      .maybeSingle(),
    db
      .from("booking_services")
      .select(
        "id,name,duration_minutes,buffer_minutes,is_active,booking_enabled,hours",
      )
      .eq("business_id", params.businessId)
      .eq("is_active", true)
      .eq("booking_enabled", true)
      .order("name"),
  ]);
  // Missing migration, disabled automation, or no bookable services: use ordinary informational replies.
  if (
    cfg.error ||
    services.error ||
    !cfg.data?.agent_booking_enabled ||
    !services.data?.length
  )
    return null;
  const settings = (cfg.data ?? defaultSettings) as CalendarSettings;
  const activeServices = services.data as BookingService[];
  const started = Date.now();
  let draft: BookingDraft =
    raw && typeof raw.nonce === "string"
      ? raw
      : {
          phase: "collect",
          nonce: randomUUID(),
          expires: Date.now() + 30 * 60000,
        };
  const reply = (text: string, clear = false): AgentTurnResult => {
    existingState.fields = { ...existingState.fields };
    if (clear) delete existingState.fields.booking;
    else existingState.fields.booking = draft;
    existingState.step_key = clear ? "choose_product" : "booking_request";
    params.onTrace?.({
      stage: "tools",
      label: "Appointment availability / reservation",
      status: "success",
      data: {
        mode: params.mode ?? "production",
        action: clear ? "request_finished" : "collect_or_review",
        writesAllowed: params.mode !== "test",
      },
    });
    return {
      reply: text,
      nextState: existingState,
      previousResponseId: null,
      workflowId: null,
      productName: null,
      workflowProgress: [],
      debug: {
        model: agentModel(),
        source: "fallback",
        fallbackReason: null,
        agentConfigured: true,
        knowledgeCount: 0,
        productCount: 0,
        workflowSteps: [],
        elapsedMs: Date.now() - started,
      },
    };
  };
  const expired = Boolean(raw && raw.expires <= Date.now());
  const needsReview = expired || params.resume;
  if (needsReview) {
    draft.phase = "collect";
    draft.expires = Date.now() + 30 * 60000;
  }
  // A booking may be for somebody else. Profile memory only seeds missing data.
  draft.name ??= existingState.context?.profile.name?.value;
  draft.contact ??= existingState.context?.profile.phone?.value ?? existingState.context?.profile.email?.value;
  if (
    draft.phase === "confirm" &&
    explicitBookingConfirmation(params.message)
  ) {
    const service = activeServices.find((s) => s.id === draft.serviceId);
    if (!service || !draft.date || !draft.time || !draft.name) {
      draft = {
        phase: "collect",
        nonce: randomUUID(),
        expires: Date.now() + 30 * 60000,
      };
      return reply("Le ta rishikojmë kërkesën. Cilin shërbim dëshiron?");
    }
    // Simulation rechecks availability without writes. Production persistence first
    // reconciles the stable request key, then checks availability transactionally.
    if (params.mode === "test") try {
      const slots = await availableSlots(params.businessId, service.id, draft.date);
      if (!slots.some(slot => zonedParts(slot.start, settings.timezone).time === draft.time)) {
        draft.phase = "collect"; draft.time = undefined;
        return reply("Ky orar nuk është më i lirë. Zgjidh një orë tjetër.");
      }
    } catch { return reply("Nuk u verifikua kalendari. Provo përsëri më vonë ose kontakto biznesin."); }
    if (params.mode === "test")
      return reply(
        `Provë: kërkesa për ${service.name}, më ${draft.date} në ${draft.time}, për ${draft.name} është gati. Nuk u krijua rezervim real.`,
        true,
      );
    if (!params.conversationKey)
      return reply("Për ta përfunduar rezervimin, kontakto biznesin.");
    if (params.routed && !params.bookingGuard)
      return reply("Rezervimi nuk mund të ruhet tani. Provo përsëri ose kontakto stafin.");
    if (params.canAct && !(await params.canAct())) throw new Error("conversation_manually_paused");
    try {
      const result = await persistBooking(params.businessId, {
        serviceId: service.id,
        name: draft.name,
        contact: draft.contact ?? "",
        start: localInstant(draft.date, draft.time, settings.timezone),
        status:
          settings.confirmation_mode === "automatic" ? "confirmed" : "pending",
        notes: "Kërkesë nga biseda Instagram",
        requestKey: `ig:${params.conversationKey}:${draft.nonce}`,
      }, params.bookingGuard);
      // A stable request key can return a booking committed before a lost response.
      // Report its persisted data, never claim a corrected draft changed that booking.
      const saved = result.booking;
      const local = zonedParts(new Date(saved.starts_at), settings.timezone);
      const summary = `${saved.service_name}, më ${local.date} në ${local.time}, në emër të ${saved.customer_name}`;
      const changed = saved.service_id !== service.id || local.date !== draft.date || local.time !== draft.time || saved.customer_name !== draft.name || saved.customer_contact !== (draft.contact ?? "");
      if (saved.status === "cancelled") return reply(`Rezervimi i kësaj kërkese është anuluar: ${summary}. Për një rezervim të ri, nis një kërkesë të re.`, true);
      const status = saved.status === "confirmed" ? "Rezervimi u konfirmua" : "Kërkesa u ruajt";
      const review = saved.status === "pending" ? " Biznesi duhet ta miratojë; takimi ende nuk është konfirmuar." : "";
      const reconciliation = changed ? " Kërkesa ishte ruajtur më parë me këto të dhëna; ndryshimet e fundit nuk u aplikuan. Për ndryshimin, kontakto stafin." : "";
      const sync = result.syncError ? " Përditësimi i kalendarit pret verifikimin e stafit." : "";
      return reply(`${status}: ${summary}.${review}${reconciliation}${sync}`, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rezervimi nuk u ruajt.";
      if (/lease|revision|stale_state|invalid_conversation|paused|ownership|workflow_(?:booking_)?guard|conversation_control/.test(message)) throw err;
      if (/orar.*(?:zënë|rezervua)|slot.*(?:busy|unavailable)/i.test(message)) {
        draft.phase = "collect"; draft.time = undefined;
        return reply(`${message} Zgjidh një orë tjetër.`);
      }
      // A timeout can occur after commit: retain the nonce and confirmation so retries reconcile.
      return reply(`${message} Provo sërish konfirmimin ose kontakto stafin.`);
    }
  }
  // A bare yes after an expired/interrupted prompt only requests a fresh review.
  const reviewOnly = needsReview && explicitBookingConfirmation(params.message);
  const details = reviewOnly ? { bookingIntent: true, cancel: false, serviceId: null, date: null, time: null, name: null, contact: null }
    : await extractBookingDetails(params.message, activeServices,
      zonedParts(new Date(), settings.timezone).date, settings.timezone, draft);
  if (!details)
    return reply(
      "Nuk e kuptova plotësisht kërkesën. Shkruaj shërbimin, datën dhe orën; ose kontakto biznesin.",
    );
  if (details.cancel)
    return reply(
      "Kërkesa u ndërpre. Nëse ke një takim të rezervuar më parë, kontakto biznesin për ta ndryshuar ose anuluar.",
      true,
    );
  if (!params.routed && !raw && !details.bookingIntent) return null;
  if (details.serviceId && details.serviceId !== draft.serviceId) {
    draft.serviceId = details.serviceId;
    draft.time = undefined;
  }
  if (details.date) {
    if (!validDate(details.date))
      return reply("Shkruaj një datë të qartë, p.sh. 2026-10-15.");
    if (details.date !== draft.date) draft.time = undefined;
    draft.date = details.date;
  }
  if (details.time) {
    if (!validTime(details.time))
      return reply(
        "Në çfarë ore dëshiron takimin? Shkruaje në formatin 24-orësh.",
      );
    draft.time = details.time;
  }
  if (details.name) draft.name = details.name;
  if (details.contact) draft.contact = details.contact;
  draft.phase = "collect";
  const service = activeServices.find((s) => s.id === draft.serviceId);
  if (!service)
    return reply(
      `Cilin shërbim dëshiron? ${activeServices.map((s) => `${s.name} (${s.duration_minutes} min)`).join(", ")}.`,
    );
  if (!draft.date) return reply(`Për çfarë date dëshiron ${service.name}?`);
  let slots;
  try {
    slots = await availableSlots(params.businessId, service.id, draft.date);
  } catch {
    return reply(
      "Nuk u verifikua kalendari. Provo përsëri më vonë ose kontakto biznesin.",
    );
  }
  if (!slots.length) {
    draft.time = undefined;
    return reply(
      `Nuk ka orare të lira për ${service.name} më ${draft.date}. Zgjidh një datë tjetër.`,
    );
  }
  if (
    !draft.time ||
    !slots.some(
      (slot) => zonedParts(slot.start, settings.timezone).time === draft.time,
    )
  ) {
    draft.time = undefined;
    return reply(
      `Më ${draft.date}, disa orare të lira për ${service.name} janë: ${slots
        .slice(0, 6)
        .map((slot) => zonedParts(slot.start, settings.timezone).time)
        .join(", ")}. Cilën orë zgjedh?`,
    );
  }
  if (!draft.name || draft.name.trim().length < 2)
    return reply("Në emër të kujt ta përgatis kërkesën?");
  draft.phase = "confirm";
  return reply(
    `${expired ? "Konfirmimi i mëparshëm skadoi; orari u kontrollua sërish. " : ""}Konfirmon ${service.name} (${service.duration_minutes} min), më ${draft.date} në ${draft.time}, në emër të ${draft.name}? Shkruaj “Konfirmoj” ose korrigjo të dhënat.${settings.confirmation_mode === "manual" ? " Pas konfirmimit tënd, kërkesa pret miratimin e biznesit." : ""}`,
  );
}
