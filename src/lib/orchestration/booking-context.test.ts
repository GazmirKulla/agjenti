import { beforeEach, expect, it, vi } from "vitest";
import { bookingContext } from "./booking-context";
import { bookingFields, expandBooking } from "./booking-definition";
import { initialSnapshot, type Instance, type ProcessDefinition } from "./contracts";
import type { VisualVersion } from "@/lib/workflows/visual/types";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./booking", () => ({ readBookingTerms: read }));
const serviceId = "11111111-1111-4111-8111-111111111111";
const { key } = bookingFields("book");
const expanded = expandBooking("book", "done");
const definition: ProcessDefinition = { id: "flow", versionId: "version", businessId: "business", name: "Booking", purpose: "Book", offerPolicy: "on_request",
  entry: "book", ...expanded, steps: [...expanded.steps, { id: "done", kind: "end", label: "Done" }] };
const version: VisualVersion = { id: "version", businessId: "business", createdAt: "today", graph: { version: 2, name: "Bookings",
  nodes: [{ id: "book", kind: "booking", label: "Booking", config: {}, position: { x: 0, y: 0 } }], edges: [],
  flows: [{ id: "flow", label: "Booking", kind: "booking", entryNodeId: "book", nodeIds: ["book"], serviceIds: [serviceId] }] } };
const instance: Instance = { id: "i", definitionId: "flow", versionId: "version", stepId: "book", status: "waiting_input", facts: {
  [key("serviceId")]: { fieldId: key("serviceId"), subject: "booking", value: serviceId, revision: 1, eventId: "e", evidence: "Consultation" },
} };
beforeEach(() => { read.mockReset(); read.mockResolvedValue({ serviceId, serviceName: "Consultation", durationMinutes: 30, bufferMinutes: 5, timezone: "UTC", confirmationMode: "manual" }); });
it("reads current terms only in the trusted tenant and maps them to the scoped node", async () => {
  const context = bookingContext([version]);
  await context.prepare({ ...initialSnapshot("business", "conversation", "test"), instances: { i: instance } }, [definition]);
  expect(read).toHaveBeenCalledWith("business", serviceId);
  expect(context.serverFacts(definition, instance)).toMatchObject({ [key("durationMinutes")]: 30 });
});
it("does not reuse terms after a failed refresh", async () => {
  const context = bookingContext([version]), state = { ...initialSnapshot("business", "conversation", "test"), instances: { i: instance } };
  await context.prepare(state, [definition]);
  read.mockRejectedValue(new Error("disabled"));
  await context.prepare(state, [definition]);
  expect(context.serverFacts(definition, instance)).toEqual({});
});
it("rejects a service outside the published flow binding", async () => {
  const restricted = structuredClone(version);
  if (restricted.graph.version === 2) restricted.graph.flows[0].serviceIds = ["other"];
  const context = bookingContext([restricted]);
  await context.prepare({ ...initialSnapshot("business", "conversation", "test"), instances: { i: instance } }, [definition]);
  expect(() => context.serverFacts(definition, instance)).toThrow("service_outside_workflow");
});
it("does not query malformed identifiers from model observations", async () => {
  const context = bookingContext([version]);
  await context.prepare(initialSnapshot("business", "conversation", "test"), [definition], { revision: 0, needsClarification: false,
    commands: [{ kind: "start", definitionId: "flow", versionId: "version", evidence: "Book", initialFacts: [{ fieldId: key("serviceId"), value: "arbitrary query", evidence: "Book" }] }] });
  expect(read).not.toHaveBeenCalled();
});
