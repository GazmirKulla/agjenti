import { expect, it } from "vitest";
import { automaticGraph, automaticReadiness } from "./automatic-process";
import { compileVisualProcesses } from "./visual-definition";
import { bookingFields, bookingServerValues } from "./booking-definition";
import { initialSnapshot, type Snapshot } from "./contracts";
import { transitionCustomer, type Environment } from "./transition";

const business = "00000000-0000-4000-8000-000000000001";
const service = "22222222-2222-4222-8222-222222222222";
const graph = automaticGraph(automaticReadiness({ modules: null, orderableProducts: false, bookingCalendar: true, bookableServices: true }))!;
const version = { id: "v1", businessId: business, graph, createdAt: "" };
const { key } = bookingFields("auto_booking");
let ids = 0;
const env: Environment = { mode: "live", now: Date.parse("2026-11-27T00:40:00Z"), definitions: compileVisualProcesses(version), startableVersionIds: new Set(["v1"]),
  tools: [], promptTtlMs: 900000, id: () => `id${++ids}`,
  serverFacts: () => bookingServerValues("auto_booking", { serviceId: service, serviceName: "Konsulencë", durationMinutes: 30, bufferMinutes: 0, timezone: "Europe/Tirane", confirmationMode: "automatic" }) };
const book = (state: Snapshot, message: string, facts: Record<string, string>) => transitionCustomer(state, { id: `e${++ids}`, businessId: business, conversationId: "c1", message, actor: "customer" },
  { revision: state.revision, needsClarification: false, commands: [{ kind: "start", definitionId: "auto_booking", versionId: "v1", evidence: message,
    initialFacts: Object.entries(facts).map(([name, value]) => ({ fieldId: key(name), value, evidence: message })) }] }, env);

it("does not ask again for the name and contact the customer gave earlier in the same conversation", () => {
  const first = "Miqail Berberi, 0694740420, konsulencë më 27 në 10:00";
  let state = book(initialSnapshot(business, "c1", "live"), first, { serviceId: service, date: "2026-11-27", time: "10:00", name: "Miqail Berberi", contact: "0694740420" }).state;
  // That booking was later cancelled; the customer then asks for another time.
  const earlier = Object.values(state.instances)[0];
  state = { ...state, revision: state.revision + 1, instances: { [earlier.id]: { ...earlier, status: "cancelled" } }, focusId: null };
  const second = "rezervo konsulencë në 11:00 më 27";
  const next = Object.values(book(state, second, { serviceId: service, date: "2026-11-27", time: "11:00" }).state.instances).find(i => i.id !== earlier.id)!;
  expect(next.facts[key("name")]).toMatchObject({ value: "Miqail Berberi", evidence: "conversation_memory" });
  expect(next.facts[key("contact")]).toMatchObject({ value: "0694740420", evidence: "conversation_memory" });
  expect(next.status).toBe("waiting_approval");
});

it("keeps a name the customer gives in the new request over the earlier one", () => {
  const first = "Ana, 0690000000, konsulencë më 27 në 10:00";
  const state = book(initialSnapshot(business, "c1", "live"), first, { serviceId: service, date: "2026-11-27", time: "10:00", name: "Ana", contact: "0690000000" }).state;
  const earlier = Object.values(state.instances)[0];
  const second = "për Besën, konsulencë më 27 në 11:00";
  const next = Object.values(book({ ...state, revision: state.revision + 1, instances: { [earlier.id]: { ...earlier, status: "cancelled" } } }, second,
    { serviceId: service, date: "2026-11-27", time: "11:00", name: "Besa" }).state.instances).find(i => i.id !== earlier.id)!;
  expect(next.facts[key("name")]).toMatchObject({ value: "Besa", evidence: second });
  expect(next.facts[key("contact")]).toMatchObject({ value: "0690000000", evidence: "conversation_memory" });
});

it("gives the interpretation today in the business's own time zone", async () => {
  const { businessTime } = await import("./observation");
  // 00:44 UTC on 27 November is already 01:44 on Friday 27 November in Tirana; 23:30 UTC on the 26th is the 27th there too.
  expect(businessTime(Date.parse("2026-11-27T00:44:00Z"), "Europe/Tirane")).toEqual({ timezone: "Europe/Tirane", date: "2026-11-27", time: "01:44", weekday: "Friday" });
  expect(businessTime(Date.parse("2026-11-26T23:30:00Z"), "Europe/Tirane")).toMatchObject({ date: "2026-11-27", weekday: "Friday" });
});
