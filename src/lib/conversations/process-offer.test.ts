import { beforeEach, describe, expect, it, vi } from "vitest";
import { availableProcessOffers, consumeProcessOffer } from "./process-offer";
import { emptyState } from "@/lib/workflows/engine";
import type { VisualVersion } from "@/lib/workflows/visual/types";
import { parseCommunicationDraft } from "./communication-contract";
const semantic = vi.hoisted(() => vi.fn());
vi.mock("./interpret-process-offer", () => ({ interpretProcessOffer: semantic }));
beforeEach(() => semantic.mockReset());
const version: VisualVersion = { id: "v1", businessId: "b", createdAt: "", graph: { version: 2, name: "Signup", nodes: [
  { id: "name", kind: "collect", label: "Name", position: { x: 0, y: 0 }, config: { fieldKey: "business_name", fieldType: "text" } },
  { id: "create", kind: "action", label: "Create", position: { x: 0, y: 0 }, config: {} },
], edges: [], flows: [{ id: "signup", kind: "custom", label: "Regjistrim", entryNodeId: "name", nodeIds: ["name", "create"] }] } };
const state = () => ({ ...emptyState(), processes: { active: null, pendingProcessOffer: { businessId: "b", versionId: "v1", flowId: "signup", prompt: "Ta nisim regjistrimin?", expiresAt: Date.now() + 60000 } }, recentMessages: [{ role: "assistant" as const, content: "Ta nisim regjistrimin?" }] });
describe("process navigation proposals", () => {
  it.each(["po", "okay", "ma dergo pra"])("binds %s to the delivered current collector only", async message => {
    semantic.mockResolvedValue({ relation: "accept", flowId: "signup", evidence: message });
    const s = state();
    expect(await consumeProcessOffer({ businessId: "b", message, hasPhoto: false, state: s, mode: "production", deliveredReply: "Ta nisim regjistrimin?" }, version)).toBe("signup");
    expect(s.processes.pendingProcessOffer).toBeUndefined();
  });
  it.each(["wrong tenant", "expired", "undelivered", "republished", "disabled", "detour"])("rejects %s without authority transfer", async reason => {
    semantic.mockResolvedValue({ relation: reason === "detour" ? "clarify" : "accept", flowId: "signup", evidence: "po" });
    const s = state();
    if (reason === "wrong tenant") s.processes.pendingProcessOffer.businessId = "other";
    if (reason === "expired") s.processes.pendingProcessOffer.expiresAt = 0;
    const v = reason === "disabled" ? null : reason === "republished" ? { ...version, id: "v2" } : version;
    expect(await consumeProcessOffer({ businessId: "b", message: reason === "detour" ? "Si lidhet Instagram?" : "po", hasPhoto: false, state: s, mode: "production", deliveredReply: reason === "undelivered" ? null : "Ta nisim regjistrimin?" }, v)).toBeUndefined();
  });
  it("never offers direct actions or confirmation entry points", () => {
    const v = structuredClone(version);
    if (v.graph.version === 2) v.graph.flows[0].entryNodeId = "create";
    expect(availableProcessOffers(v)).toEqual([]);
  });
  it("allows a single tracked process question, never two questions or hidden fields", () => {
    const draft = { answer: "Mund të fillosh këtu.", question: null, processOffer: { flowId: "signup", text: "Ta nisim?" } };
    expect(parseCommunicationDraft(draft)?.processOffer?.flowId).toBe("signup");
    expect(parseCommunicationDraft({ ...draft, answer: "Si je?" })).toBeNull();
    expect(parseCommunicationDraft({ ...draft, processOffer: { ...draft.processOffer, execute: true } })).toBeNull();
  });
});
it("preserves the proposal through clarification and resolves subsequent acceptance in context", async () => {
  const s = state();
  semantic.mockResolvedValueOnce({ relation: "clarify", flowId: "signup", evidence: "Cilat të dhëna duhen?" });
  expect(await consumeProcessOffer({ businessId: "b", message: "Cilat të dhëna duhen?", hasPhoto: false, state: s, mode: "production", deliveredReply: "Ta nisim regjistrimin?" }, version)).toBeUndefined();
  expect(s.processes.pendingProcessOffer).toBeDefined();
  s.recentMessages.push({ role: "assistant", content: "Emri i biznesit dhe emaili i pronarit." });
  semantic.mockResolvedValueOnce({ relation: "accept", flowId: "signup", evidence: "Procediamo con la registrazione" });
  expect(await consumeProcessOffer({ businessId: "b", message: "Procediamo con la registrazione", hasPhoto: false, state: s, mode: "production", deliveredReply: "Emri i biznesit dhe emaili i pronarit." }, version)).toBe("signup");
});
it.each([null, { relation: "uncertain", flowId: null }, { relation: "other", flowId: null }])("does not consume a proposal on failed or unrelated interpretation: %j", async interpretation => {
  semantic.mockResolvedValue(interpretation);
  const s = state();
  expect(await consumeProcessOffer({ businessId: "b", message: "okay", hasPhoto: false, state: s, mode: "test" }, version)).toBeUndefined();
  expect(s.processes.pendingProcessOffer).toBeDefined();
});
