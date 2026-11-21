import { describe, expect, it } from "vitest";
import { automaticGraph, automaticReadiness } from "./automatic-process";
import { compileVisualProcesses } from "./visual-definition";
import { bookingManageContext } from "./booking-manage";
import { bookingChangeToolPolicy, bookingManageFields, bookingMineToolPolicy } from "./booking-manage-definition";
import { initialSnapshot, TransitionError, type Observation, type Snapshot } from "./contracts";
import { recordPresentation, transitionActionDispatch, transitionActionResult, transitionCustomer, type Environment } from "./transition";
import { processCapabilityEvents } from "@/lib/tracking/process-events";
import type { OwnBooking } from "@/lib/calendar/own-bookings";

const business = "00000000-0000-4000-8000-000000000001";
const mine: OwnBooking = { id: "11111111-1111-4111-8111-111111111111", serviceId: "22222222-2222-4222-8222-222222222222", serviceName: "Prerje flokësh",
  date: "2026-12-04", time: "10:00", startsAt: "2026-12-04T09:00:00Z", status: "confirmed", revision: 3, changeable: true };
const foreign = "33333333-3333-4333-8333-333333333333";
const graph = automaticGraph(automaticReadiness({ modules: null, orderableProducts: false, bookingCalendar: true, bookableServices: true }))!;
const version = { id: "v1", businessId: business, graph, createdAt: "" };
const { key } = bookingManageFields("auto_booking_manage");
let ids = 0;

function setup(bookings: OwnBooking[]) {
  const manage = bookingManageContext([version], bookings);
  const env: Environment = { mode: "live", now: Date.parse("2026-11-21T10:00:00Z"), definitions: manage.definitions(compileVisualProcesses(version)), startableVersionIds: new Set(["v1"]),
    tools: [bookingMineToolPolicy(true), bookingChangeToolPolicy(true)], promptTtlMs: 900000, id: () => `id${++ids}`, serverFacts: manage.serverFacts };
  return { env, manage };
}
const event = (message: string) => ({ id: `e${++ids}`, businessId: business, conversationId: "c1", message, actor: "customer" as const });
function turn(state: Snapshot, env: Environment, message: string, commands: Observation["commands"]) {
  const result = transitionCustomer(state, event(message), { revision: state.revision, commands, needsClarification: false }, env);
  return { ...result, state: { ...result.state, revision: result.state.revision + 1 } };
}
/** The executor's part: claim the prepared action and record the adapter's receipt. */
function effect(state: Snapshot, env: Environment, output: Record<string, string | number>) {
  const instance = Object.values(state.instances)[0];
  const running = transitionActionDispatch(state, instance.id, instance.action!.id, env);
  return transitionActionResult(running, { instanceId: instance.id, actionId: instance.action!.id, status: "succeeded", output }, env);
}
const start = (message: string, action: string, extra: { fieldId: string; value: string }[] = []) => ({ kind: "start" as const, definitionId: "auto_booking_manage", versionId: "v1",
  evidence: message, initialFacts: [{ fieldId: key("action"), value: action, evidence: message }, ...extra.map(f => ({ ...f, evidence: message }))] });

describe("the customer's own booking: status, cancellation and a move", () => {
  it("answers the status from the verified read and ends there", () => {
    const { env } = setup([mine]);
    const asked = turn(initialSnapshot(business, "c1", "live"), env, "kur e kam terminin?", [start("kur e kam terminin?", "status")]);
    const instance = Object.values(asked.state.instances)[0];
    expect(instance.action).toMatchObject({ tool: "booking.mine", status: "prepared" });
    const done = effect(asked.state, env, { bookings: "[]", count: 1 });
    const finished = Object.values(done.state.instances)[0];
    expect(finished.status).toBe("completed");
    expect(processCapabilityEvents(asked.state, done.state, done.notices, () => env.definitions.find(d => d.id === "auto_booking_manage"))).toEqual([expect.objectContaining({ capability: "customer.booking_manage", point: "answered" })]);
  });

  it("cancels only the customer's own booking, after the customer confirms what the server read", () => {
    const { env } = setup([mine]);
    const message = "dua ta anuloj rezervimin";
    let state = turn(initialSnapshot(business, "c1", "live"), env, message, [start(message, "cancel", [{ fieldId: key("bookingId"), value: mine.id }])]).state;
    state = effect(state, env, { bookings: "[]", count: 1 }).state;
    const waiting = Object.values(state.instances)[0];
    expect(waiting.status).toBe("waiting_approval");
    // The reviewed facts are the server's, from the customer's own booking.
    expect(waiting.facts[key("startsAt")].value).toBe("2026-12-04 10:00");
    expect(waiting.facts[key("bookingRevision")].value).toBe(3);
    state = recordPresentation(state, [waiting.wait!.id], env.now);
    const approved = turn(state, env, "po, anuloje", [{ kind: "approve", instanceId: waiting.id, waitId: waiting.wait!.id, evidence: "po, anuloje" }]);
    const action = Object.values(approved.state.instances)[0].action!;
    expect(action).toMatchObject({ tool: "booking.change", input: { action: "cancel", bookingId: mine.id, bookingRevision: 3 } });
    const done = effect(approved.state, env, { bookingId: mine.id, action: "cancel", status: "cancelled" });
    expect(processCapabilityEvents(approved.state, done.state, done.notices, () => env.definitions.find(d => d.id === "auto_booking_manage"))).toEqual([expect.objectContaining({ point: "cancelled" })]);
  });

  it("moves a booking to a new date and time reviewed together", () => {
    const { env } = setup([mine]);
    const message = "a mund ta kaloj te 5 dhjetori ora 11:00?";
    let state = turn(initialSnapshot(business, "c1", "live"), env, message, [start(message, "reschedule", [
      { fieldId: key("bookingId"), value: mine.id }, { fieldId: key("date"), value: "2026-12-05" }, { fieldId: key("time"), value: "11:00" }])]).state;
    state = effect(state, env, { bookings: "[]", count: 1 }).state;
    const waiting = Object.values(state.instances)[0];
    expect(waiting.status).toBe("waiting_approval");
    state = recordPresentation(state, [waiting.wait!.id], env.now);
    const approved = turn(state, env, "po", [{ kind: "approve", instanceId: waiting.id, waitId: waiting.wait!.id, evidence: "po" }]);
    expect(Object.values(approved.state.instances)[0].action).toMatchObject({ tool: "booking.change", input: { action: "reschedule", date: "2026-12-05", time: "11:00" } });
  });

  it("never accepts a booking that is not this customer's", () => {
    const { env } = setup([mine]);
    const message = "anuloje";
    expect(() => turn(initialSnapshot(business, "c1", "live"), env, message, [start(message, "cancel", [{ fieldId: key("bookingId"), value: foreign }])]))
      .toThrow(TransitionError);
  });

  it("says there is nothing to change when the customer has no upcoming booking", () => {
    const { env } = setup([]);
    const message = "dua ta anuloj";
    const asked = turn(initialSnapshot(business, "c1", "live"), env, message, [start(message, "cancel")]);
    const done = effect(asked.state, env, { bookings: "[]", count: 0 });
    const instance = Object.values(done.state.instances)[0];
    expect(instance.status).toBe("completed");
    expect(instance.stepId).toBe(key("none"));
    expect(processCapabilityEvents(asked.state, done.state, done.notices, () => env.definitions.find(d => d.id === "auto_booking_manage"))).toEqual([expect.objectContaining({ point: "no_booking" })]);
  });
});
