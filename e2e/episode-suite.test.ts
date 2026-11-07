/** Six recorded configurations × four languages × three repetitions = 72 episodes.
 * Real model, test-mode runtime, no database or live adapters. Opt-in only. */
import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { initialSnapshot, type ProcessDefinition } from "../src/lib/orchestration/contracts";
import { interpretCustomer } from "../src/lib/orchestration/interpret";
import { recordPresentation, transitionCustomer, type Environment } from "../src/lib/orchestration/transition";
import { expandBooking, bookingFields, bookingServerValues, bookingToolPolicy } from "../src/lib/orchestration/booking-definition";

const live = it.skipIf(process.env.RUN_EPISODE_SUITE !== "1");
const languages = ["sq", "en", "it", "tr"] as const;
const flows = ["shop", "booking", "b2b", "registration", "information", "support"] as const;
const repetitions = [1, 2, 3] as const;
type Language = (typeof languages)[number];
type Flow = (typeof flows)[number];
const serviceId = "11111111-1111-4111-8111-111111111111";
const bookingTerms = { serviceId, serviceName: "Konsulte", durationMinutes: 30, bufferMinutes: 10, timezone: "Europe/Tirane", confirmationMode: "manual" as const };
const copy: Record<Language, {
  start: string; fact: string; detour: string; approve: string;
}> = {
  sq: { start: "Dua ta nis këtë kërkesë tani.", fact: "Përdor demo@example.test dhe madhësinë M. Buxheti është 200. Projekti është website. Çështja është vonesa e dërgesës. Shërbimi është Konsulte më 2026-12-01 në 10:00. Emri Klient Test.", detour: "Para se të vendos, çfarë ndodh pastaj?", approve: "Po, vazhdoje kërkesën me këto të dhëna." },
  en: { start: "I want to start this request now.", fact: "Use demo@example.test and size M. The budget is 200. The project is website. The issue is a delayed delivery. The service is Konsulte on 2026-12-01 at 10:00. Name Client Test.", detour: "Before I decide, what happens next?", approve: "Yes, proceed with the request using those details." },
  it: { start: "Voglio avviare questa richiesta ora.", fact: "Usa demo@example.test e taglia M. Il budget è 200. Il progetto è website. Il problema è una consegna in ritardo. Il servizio è Konsulte il 2026-12-01 alle 10:00. Nome Cliente Test.", detour: "Prima di decidere, cosa succede dopo?", approve: "Sì, procedi con la richiesta usando questi dati." },
  tr: { start: "Bu talebi şimdi başlatmak istiyorum.", fact: "demo@example.test ve beden M kullan. Bütçe 200. Proje website. Sorun geciken teslimat. Hizmet Konsulte, 2026-12-01 10:00. Ad Client Test.", detour: "Karar vermeden önce bundan sonra ne olur?", approve: "Evet, bu bilgilerle talebi ilerlet." },
};
const outcomes: { episode: string; ok: boolean; reason?: string; model?: string; inputTokens?: number; outputTokens?: number; elapsedMs?: number }[] = [];

function shop(): ProcessDefinition {
  return {
    id: "shop", versionId: "episode-v1", businessId: "episode-business", name: "Product request",
    purpose: "Collect size and contact email for a product request. No order is placed from this confirmation.",
    offerPolicy: "on_request", entry: "size",
    fields: [
      { id: "size", subject: "order", label: "Size", type: "text", required: true },
      { id: "email_registration", subject: "organization", label: "Contact email", type: "email", required: true },
    ],
    steps: [
      { id: "size", kind: "collect", fieldId: "size", next: "email" },
      { id: "email", kind: "collect", fieldId: "email_registration", next: "review" },
      { id: "review", kind: "confirm", fieldIds: ["size", "email_registration"], label: "Review the product request", yes: "done", no: "declined" },
      { id: "done", kind: "end", label: "Request collected" }, { id: "declined", kind: "end", label: "Request declined" },
    ],
  };
}
function registration(): ProcessDefinition {
  return {
    id: "registration", versionId: "episode-v1", businessId: "episode-business", name: "Consultation request",
    purpose: "Collect the organization's contact email to request a consultation",
    offerPolicy: "when_relevant", entry: "email",
    fields: [{ id: "email_registration", subject: "organization", label: "Organization email", type: "email", required: true }],
    steps: [
      { id: "email", kind: "collect", fieldId: "email_registration", next: "review" },
      { id: "review", kind: "confirm", fieldIds: ["email_registration"], label: "Review the consultation request", yes: "done", no: "declined" },
      { id: "done", kind: "end", label: "Request collected" }, { id: "declined", kind: "end", label: "Request declined" },
    ],
  };
}
function b2b(): ProcessDefinition {
  return {
    id: "b2b", versionId: "episode-v1", businessId: "episode-business", name: "Quote request",
    purpose: "Collect a structured project type and budget, then review before staff follow-up",
    offerPolicy: "on_request", entry: "project",
    fields: [
      { id: "project_type", subject: "organization", label: "Project type", type: "text", required: true },
      { id: "budget", subject: "organization", label: "Budget", type: "number", required: true },
    ],
    steps: [
      { id: "project", kind: "collect", fieldId: "project_type", next: "budget" },
      { id: "budget", kind: "collect", fieldId: "budget", next: "review" },
      { id: "review", kind: "confirm", fieldIds: ["project_type", "budget"], label: "Review the quote request", yes: "done", no: "declined" },
      { id: "done", kind: "end", label: "Request collected" }, { id: "declined", kind: "end", label: "Request declined" },
    ],
  };
}
function support(): ProcessDefinition {
  return {
    id: "support", versionId: "episode-v1", businessId: "episode-business", name: "Support",
    purpose: "Collect the customer issue and hand the conversation to staff. No business effect.",
    offerPolicy: "on_request", entry: "issue",
    fields: [{ id: "issue", subject: "customer", label: "Issue", type: "text", required: true }],
    steps: [
      { id: "issue", kind: "collect", fieldId: "issue", next: "staff" },
      { id: "staff", kind: "handoff", label: "Staff will continue this conversation" },
    ],
  };
}
function booking(): ProcessDefinition {
  const expanded = expandBooking("book", "done");
  return {
    id: "booking", versionId: "episode-v1", businessId: "episode-business", name: "Booking",
    purpose: "Book a consultation after a separate review and approval",
    offerPolicy: "on_request", entry: "book", fields: expanded.fields,
    steps: [...expanded.steps, { id: "done", kind: "end", label: "Booking submitted" }],
  };
}
function definitionFor(flow: Flow): ProcessDefinition | null {
  if (flow === "information") return null;
  if (flow === "shop") return shop();
  if (flow === "registration") return registration();
  if (flow === "b2b") return b2b();
  if (flow === "support") return support();
  return booking();
}
function environment(definition: ProcessDefinition | null): Environment {
  const definitions = definition ? [definition] : [];
  return {
    mode: "test", now: Date.now(), definitions, startableVersionIds: new Set(definitions.map(d => d.versionId)),
    tools: definition?.id === "booking" ? [bookingToolPolicy(true)] : [], promptTtlMs: 120000,
    ...(definition?.id === "booking" ? { serverFacts: () => bookingServerValues("book", bookingTerms) } : {}),
    id: () => randomUUID(),
  };
}

async function turn(state: ReturnType<typeof initialSnapshot>, env: Environment, message: string, history: { role: "user" | "assistant"; content: string }[], extras?: Parameters<typeof interpretCustomer>[0]["observationExtras"]) {
  const interpretation = await interpretCustomer({
    message, state, env, history, deadline: Date.now() + 16000,
    businessContext: { instructions: "Use only the supplied process definitions. Test mode. Never claim a live order, booking or staff notification was executed.", knowledge: [] },
    observationExtras: extras,
  });
  const event = { id: randomUUID(), businessId: state.businessId, conversationId: state.conversationId, actor: "customer" as const, message };
  return { interpretation, result: transitionCustomer(state, event, interpretation.observation, env) };
}

const cases = flows.flatMap(flow => languages.flatMap(language => repetitions.map(repetition => ({ flow, language, repetition }))));
live.each(cases)("$flow / $language #$repetition", async ({ flow, language, repetition }) => {
  const episode = `${flow}/${language}#${repetition}`;
  const text = copy[language];
  const definition = definitionFor(flow);
  const env = environment(definition);
  const base = initialSnapshot("episode-business", `episode-${flow}-${language}-${repetition}`, "test");
  let tokens = 0, elapsed = 0, model: string | undefined;
  const account = (interpretation: Awaited<ReturnType<typeof interpretCustomer>>) => {
    model = interpretation.model;
    tokens += interpretation.inputTokens + interpretation.outputTokens;
    elapsed += interpretation.elapsedMs;
  };
  try {
    if (flow === "information") {
      const { interpretation, result } = await turn(base, env, text.detour, [{ role: "assistant", content: "Orari i hapjes është në faqen e biznesit." }]);
      account(interpretation);
      expect(result.state.instances).toEqual({});
      expect(result.actions).toEqual([]);
      expect(interpretation.observation.commands.some(c => c.kind === "start" || c.kind === "approve")).toBe(false);
      outcomes.push({ episode, ok: true, model, inputTokens: interpretation.inputTokens, outputTokens: interpretation.outputTokens, elapsedMs: elapsed });
      return;
    }
    const started = transitionCustomer(base, {
      id: randomUUID(), businessId: base.businessId, conversationId: base.conversationId, actor: "customer", message: text.start,
    }, { revision: 0, needsClarification: false, commands: [{ kind: "start", definitionId: definition!.id, versionId: definition!.versionId, initialFacts: [], evidence: text.start }] }, env);
    const id = started.state.focusId!;
    expect(id).toBeTruthy();
    let state = recordPresentation(started.state, [started.state.instances[id].wait!.id], env.now);
    const extras = flow === "booking" ? { services: [{ id: serviceId, name: "Konsulte" }] } : undefined;
    const facts = await turn(state, env, text.fact, [{ role: "assistant", content: "Cilat të dhëna të duhen për këtë kërkesë?" }], extras);
    account(facts.interpretation);
    state = facts.result.state;
    expect(facts.result.actions, JSON.stringify(facts.interpretation.observation)).toEqual([]);
    if (flow === "support") {
      expect(state.instances[id].status, JSON.stringify(facts.interpretation.observation)).toBe("handoff");
      outcomes.push({ episode, ok: true, model, elapsedMs: elapsed });
      return;
    }
    if (flow === "booking") {
      expect(state.instances[id].facts[bookingFields("book").key("serviceId")]?.value, JSON.stringify(facts.interpretation.observation)).toBe(serviceId);
    }
    if (state.instances[id].status !== "waiting_approval") {
      const wait = state.instances[id].wait;
      if (wait) state = recordPresentation(state, [wait.id], env.now);
      const more = await turn(state, env, text.fact, [{ role: "assistant", content: "Mungojnë ende të dhëna të kërkesës." }], extras);
      account(more.interpretation);
      state = more.result.state;
    }
    expect(state.instances[id].status, JSON.stringify(facts.interpretation.observation)).toBe("waiting_approval");
    const target = state.instances[id].wait!.id;
    state = recordPresentation(state, [target], env.now);
    env.now = Date.now();
    const interruption = await turn(state, env, text.detour, [{ role: "assistant", content: "Konfirmoni kërkesën me të dhënat e paraqitura?" }], extras);
    account(interruption.interpretation);
    expect(interruption.result.state.instances[id].status).toBe("waiting_approval");
    expect(interruption.result.state.instances[id].wait!.id).toBe(target);
    expect(interruption.result.actions).toEqual([]);
    const approved = await turn(state, env, text.approve, [{ role: "assistant", content: "Konfirmoni kërkesën me të dhënat e paraqitura?" }], extras);
    account(approved.interpretation);
    if (flow === "booking") {
      expect(approved.result.actions, JSON.stringify(approved.interpretation.observation)).toHaveLength(1);
      expect(approved.result.actions[0].tool).toBe("booking.create");
    } else {
      expect(approved.result.state.instances[id].status, JSON.stringify(approved.interpretation.observation)).toBe("completed");
      expect(approved.result.actions).toEqual([]);
    }
    outcomes.push({ episode, ok: true, model, elapsedMs: elapsed });
  } catch (error) {
    outcomes.push({ episode, ok: false, reason: error instanceof Error ? error.message : String(error), model, elapsedMs: elapsed });
    throw error;
  }
});

afterAll(() => {
  if (!outcomes.length) return;
  const failed = outcomes.filter(o => !o.ok);
  const rate = (outcomes.length - failed.length) / outcomes.length;
  console.info(JSON.stringify({ episodes: outcomes.length, passed: outcomes.length - failed.length, rate, failed: failed.map(f => f.episode) }));
  expect(outcomes.length, "suite records every episode that ran").toBe(72);
  expect(rate, "normal episodes must stay at or above 95%").toBeGreaterThanOrEqual(0.95);
});
