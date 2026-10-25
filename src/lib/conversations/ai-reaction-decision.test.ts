import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const model = vi.hoisted(() => ({ create: vi.fn(), options: vi.fn() }));
vi.mock("openai", () => ({ default: class { constructor(options: unknown) { model.options(options); } responses = { create: model.create }; } }));
vi.mock("@/lib/agents/generate", () => ({ agentModel: () => "existing-test-model" }));
import { decideAiReaction, hasUnfinishedWork } from "./ai-reaction-decision";
import { emptyState } from "@/lib/workflows/engine";
const context = { history: [{ role: "user" as const, content: "Ku është dyqani?" }, { role: "assistant" as const, content: "Adresa është Rruga Test 1." }], preparedReply: "Me kënaqësi!", pendingWork: false };
const base = { channel: "instagram", autoReplyEnabled: true, humanTakeover: false, text: "je i madh rrofsh", context };
const positive = { classification: "positive_closure", unresolvedWork: false, emoji: "🙏", confidence: .99, evidence: base.text };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("OPENAI_API_KEY", "synthetic-never-sent"); model.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify(positive) }); });
afterEach(() => vi.unstubAllEnvs());

describe("context, not positive-word matching", () => {
  it("does not celebrate thanks while a complaint is still unresolved", async () => {
    const input = { channel: "instagram", autoReplyEnabled: true, humanTakeover: false, text: "Faleminderit",
      context: { history: [{ role: "user" as const, content: "Problemi ende nuk është zgjidhur." }],
        preparedReply: "Po presim staf për zgjidhjen.", pendingWork: true } };
    expect((await decideAiReaction(input)).kind).toBe("none");
  });
  it("does not treat a positive word with no conversation context as closure", async () => {
    const input = { channel: "instagram", autoReplyEnabled: true, humanTakeover: false, text: "Super",
      context: { history: [], preparedReply: "Si mund të ndihmoj?", pendingWork: false } };
    expect((await decideAiReaction(input)).kind).toBe("none");
  });
});

describe("contextual classifier contract (synthetic model, not semantic certification)", () => {
  it.each([
    [{ ...base, autoReplyEnabled: false }, "auto_reply_disabled"],
    [{ ...base, humanTakeover: true }, "human_takeover"],
    [{ ...base, manualEmoji: "👍" }, "manual_ownership"],
    [{ ...base, manualEmoji: "" }, "manual_ownership"],
    [{ ...base, channel: "email" }, "unsupported_channel"],
    [{ ...base, context: undefined }, "unfinished_or_missing_context"],
    [{ ...base, context: { ...context, pendingWork: true } }, "unfinished_or_missing_context"],
  ])("does not call a model when guarded (%j)", async (input, reason) => {
    expect(await decideAiReaction(input)).toMatchObject({ kind: "none", reason }); expect(model.create).not.toHaveBeenCalled();
  });
  it("accepts a supported contextual judgement without requiring gratitude keywords", async () => {
    expect(await decideAiReaction(base)).toMatchObject({ kind: "reaction", emoji: "🙏" });
    const request = model.create.mock.calls[0][0];
    expect(JSON.parse(request.input)).toMatchObject({ history: context.history, currentMessage: base.text, preparedReply: context.preparedReply });
    expect(request).toMatchObject({ model: "existing-test-model", store: false, max_output_tokens: 350 });
    expect(request.tools).toBeUndefined(); expect(request.previous_response_id).toBeUndefined();
    expect(model.options).toHaveBeenCalledWith(expect.objectContaining({ timeout: 4000, maxRetries: 0 }));
  });
  it.each(["ongoing", "unresolved", "negative", "ambiguous"])("respects %s context even for the same praise", async classification => {
    model.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ ...positive, classification }) });
    expect((await decideAiReaction({ ...base, context: { ...context, history: [context.history[0], { role: "assistant", content: "Nuk është zgjidhur ende." }] } })).kind).toBe("none");
  });
  it.each([{ unresolvedWork: true }, { confidence: .94 }, { confidence: 2 }, { confidence: "1" }, { emoji: "💸" }, { evidence: "invented" }, { evidence: "" }])("rejects unsafe or unsupported judgement %j", async patch => {
    model.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ ...positive, ...patch }) });
    expect((await decideAiReaction(base)).kind).toBe("none");
  });
  it.each(["incomplete", "failed", "cancelled"])("rejects %s model results", async status => {
    model.create.mockResolvedValue({ status, output_text: JSON.stringify(positive) });
    expect((await decideAiReaction(base)).kind).toBe("none");
  });
  it.each(["", "not json", "null", "{}"])('fails closed for malformed/refused output %j', async output_text => {
    model.create.mockResolvedValue({ status: "completed", output_text }); expect((await decideAiReaction(base)).kind).toBe("none");
  });
  it("skips missing credentials and model errors without a keyword fallback", async () => {
    vi.stubEnv("OPENAI_API_KEY", ""); expect((await decideAiReaction(base)).kind).toBe("none"); expect(model.create).not.toHaveBeenCalled();
    vi.stubEnv("OPENAI_API_KEY", "synthetic"); model.create.mockRejectedValue(new Error("Synthetic timeout"));
    expect((await decideAiReaction({ ...base, text: "Faleminderit" })).kind).toBe("none");
  });
  it("bounds history and refuses to truncate an oversized current message or reply", async () => {
    await decideAiReaction({ ...base, context: { ...context, history: [...Array(20).fill(context.history[0]), ...context.history] } });
    expect(JSON.parse(model.create.mock.calls[0][0].input).history).toHaveLength(10);
    model.create.mockClear();
    expect((await decideAiReaction({ ...base, text: "x".repeat(2001) })).kind).toBe("none");
    expect((await decideAiReaction({ ...base, context: { ...context, preparedReply: "x".repeat(4001) } })).kind).toBe("none");
    expect(model.create).not.toHaveBeenCalled();
  });
});

describe("existing state remains authoritative over positive model judgement", () => {
  it("does not mistake an acknowledgement pause for unfinished work", () => {
    expect(hasUnfinishedWork({ ...emptyState(), conversationPaused: true })).toBe(false);
  });
  it.each(["active", "suspended"] as const)("blocks %s bookings", status => {
    expect(hasUnfinishedWork({ ...emptyState(), processes: { active: null, booking: { id: "booking", status } } })).toBe(true);
  });
  it("blocks pending confirmation, staff handoff and selected unfinished orders without mutating state", () => {
    for (const state of [{ ...emptyState(), staffHandoff: true }, { ...emptyState(), product_id: "selected" },
      { ...emptyState(), context: { profile: {}, order: {}, execution: { awaitingOrderConfirmation: true } } }]) {
      const before = structuredClone(state); expect(hasUnfinishedWork(state)).toBe(true); expect(state).toEqual(before);
    }
  });
  it("allows a completed booking but not a waiting visual cursor", () => {
    expect(hasUnfinishedWork({ ...emptyState(), processes: { active: null, booking: { id: "booking", status: "completed" } } })).toBe(false);
    expect(hasUnfinishedWork({ ...emptyState(), visual: { versionId: "A", nodeId: "confirm", status: "waiting", awaiting: true, visited: [], values: {} } })).toBe(true);
  });
});
