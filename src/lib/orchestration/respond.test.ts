import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialSnapshot, type ProcessDefinition, type Value } from "./contracts";
import { orderFields } from "./order-definition";
import { bookingFields } from "./booking-definition";
import { reviewLines } from "./review-summary";
import { composeProcessReply } from "./respond";
import type { Environment } from "./transition";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/ai/openai", () => ({ default: class { responses = { create }; } }));
beforeEach(() => { create.mockReset(); vi.stubEnv("OPENAI_API_KEY", "synthetic-test"); });
afterEach(() => vi.unstubAllEnvs());
const env: Environment = { mode: "test", now: 1, definitions: [], startableVersionIds: new Set(), tools: [], promptTtlMs: 1000 };
const input = () => ({ message: "How does it work?", history: [], state: initialSnapshot("business", "conversation", "test"), env,
  notices: [], context: { instructions: "", knowledge: [] }, deadline: Date.now() + 10000 });
function respond(prompts: unknown) { create.mockResolvedValue({ status: "completed", id: "response", output_text: JSON.stringify({ answer: "Verified information", prompts }) }); }
it("constrains an informational response to zero process targets in the model schema", async () => {
 respond({});
 expect(await composeProcessReply(input())).toMatchObject({ reply: "Verified information", targetIds: [] });
 const schema = create.mock.calls[0][0].text.format.schema.properties.prompts;
 expect(schema).toEqual({ type: "object", additionalProperties: false, required: [], properties: {} });
});
it.each([{ invented: "Confirm?" }, [], null])("rejects unauthorized target output %j even if a provider ignores the schema", async prompts => {
 respond(prompts);
 await expect(composeProcessReply(input())).rejects.toThrow("invalid_reply_targets");
});
it("binds prompt text to the exact server key and emits each target once", async () => {
 respond({ "offer-id": "Would you like to start?" });
 const state = input();
 const result = await composeProcessReply({ ...state, notices: [{ kind: "offer", targetId: "offer-id" }, { kind: "offer", targetId: "offer-id" }] });
 expect(result.targetIds).toEqual(["offer-id"]);
 expect(result.reply).toBe("Verified information\n\nWould you like to start?");
 expect(create.mock.calls[0][0].text.format.schema.properties.prompts).toMatchObject({ required: ["offer-id"], properties: { "offer-id": { type: "string" } } });
});
it("renders catalog slots from supplied ids and does not invent presentation from names", async () => {
  create.mockResolvedValue({ status: "completed", id: "response", output_text: JSON.stringify({ answer: "See [[product:p2]]", prompts: {} }) });
  const result = await composeProcessReply({ ...input(), context: { instructions: "", knowledge: [], products: { records: [{ id: "p2", name: "Second" }, { id: "p1", name: "First" }] } } });
  expect(result.reply).toContain("Second");
  expect(result.presented).toEqual({ kind: "product", items: [{ id: "p2", name: "Second" }] });
});
it.each([{}, { wrong: "Confirm?" }, { "offer-id": "" }, { "offer-id": 42 }])("rejects missing, replaced, blank or malformed target text %j", async prompts => {
 respond(prompts);
 await expect(composeProcessReply({ ...input(), notices: [{ kind: "offer", targetId: "offer-id" }] })).rejects.toThrow("invalid_reply_targets");
});

describe("the review a customer approves", () => {
  const order = orderFields("flow");
  const booking = bookingFields("node");
  const fact = (fieldId: string, value: Value) => ({ fieldId, value, subject: "s", revision: 1, eventId: "e", evidence: "" });
  const orderFacts = (quantity = 1) => Object.fromEntries([
    [order.key("productId"), "de77ae2d-3bad-4635-8866-fc3fb200ee69"], [order.key("productName"), "Paketa Parashkollore"],
    [order.key("productTypeId"), "0f0e7a52-1111-4222-8333-444455556666"], [order.key("unitAmount"), 990], [order.key("currency"), "ALL"],
    [order.key("quantity"), quantity], [order.key("options"), "{}"], ["customer_name", "Arta"], ["customer_phone", "+355690000000"], ["customer_city", "Tiranë"],
  ].map(([id, value]) => [id, fact(id as string, value as Value)]));
  const ids = order.fields.map(f => f.id);

  it("shows what the customer decides, with the price in its currency, and never a catalog identifier or a raw option list", () => {
    const lines = reviewLines(ids, order.fields, orderFacts());
    expect(lines.map(l => l.value)).toEqual(["Paketa Parashkollore", "990 ALL", "Arta", "+355690000000", "Tiranë"]);
    expect(JSON.stringify(lines)).not.toMatch(/de77ae2d|0f0e7a52|\{\}/);
  });
  it("shows a quantity other than one and the total it costs", () => {
    const lines = reviewLines(ids, order.fields, orderFacts(2.5));
    expect(lines.map(l => l.value)).toEqual(["Paketa Parashkollore", "2.5", "2475 ALL", "Arta", "+355690000000", "Tiranë"]);
  });
  it("leaves out an address the business made optional and the customer did not give", () => {
    expect(reviewLines(ids, order.fields, orderFacts()).some(l => l.id === "customer_address")).toBe(false);
  });
  it("reviews a booking by its service, time and contact, not its scheduling internals", () => {
    const facts = Object.fromEntries([["serviceId", "11111111-2222-4333-8444-555566667777"], ["serviceName", "Prerje flokësh"], ["date", "2026-11-20"], ["time", "10:30"],
      ["name", "Arta"], ["contact", "+355690000000"], ["durationMinutes", 45], ["bufferMinutes", 10], ["timezone", "Europe/Tirane"], ["confirmationMode", "manual"]]
      .map(([name, value]) => [booking.key(name as string), fact(booking.key(name as string), value as Value)]));
    expect(reviewLines(booking.fields.map(f => f.id), booking.fields, facts).map(l => l.value)).toEqual(["Prerje flokësh", "45 min", "2026-11-20", "10:30", "Arta", "+355690000000"]);
  });

  it("asks the model for one label per review line and keeps the server's values next to them", async () => {
    const definition: ProcessDefinition = { id: "flow", versionId: "v", businessId: "business", name: "Porosi", purpose: "p", offerPolicy: "when_relevant", entry: "review",
      fields: order.fields, steps: [{ id: "review", kind: "confirm", fieldIds: ids, yes: "done", no: "done", label: "Review" }, { id: "done", kind: "end", label: "done" }] };
    const state = initialSnapshot("business", "conversation", "test");
    state.instances.i = { id: "i", definitionId: "flow", versionId: "v", status: "waiting", stepId: "review", facts: orderFacts() } as unknown as typeof state.instances.i;
    const labels = { [order.key("productName")]: "Produkti", [order.key("unitAmount")]: "Çmimi", customer_name: "Emri", customer_phone: "Telefoni", customer_city: "Qyteti" };
    create.mockResolvedValue({ status: "completed", id: "r", output_text: JSON.stringify({ answer: "", prompts: { w: "A e konfirmoni porosinë?" }, reviewLabels: { w: { ...labels, customer_phone: "Tel\nefoni" } } }) });
    const result = await composeProcessReply({ ...input(), state, env: { ...env, definitions: [definition] }, notices: [{ kind: "approval", instanceId: "i", targetId: "w" }] });
    expect(result.reply).toBe(`Produkti: Paketa Parashkollore\nÇmimi: 990 ALL\nEmri: Arta\n${order.fields.find(f => f.id === "customer_phone")!.label}: +355690000000\nQyteti: Tiranë\n\nA e konfirmoni porosinë?`);
    expect(create.mock.calls[0][0].text.format.schema.properties.reviewLabels).toMatchObject({ required: ["w"], properties: { w: { required: Object.keys(labels) } } });
  });
});
