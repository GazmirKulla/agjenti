import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ai/openai", () => ({ default: class { responses = { create: vi.fn() }; } }));
vi.mock("@/lib/business-assistant/persistence", () => ({ persistedTurn: vi.fn(), readConversation: vi.fn(), writeConversation: vi.fn(), PersistenceError: class extends Error {} }));
vi.mock("./continuation-service", () => ({ answerContinuation: vi.fn(), loadContinuation: vi.fn() }));
import { interpretAnswer, onboardingConversationId, onboardingTurn } from "./assistant-chat";
import { persistedTurn, readConversation } from "@/lib/business-assistant/persistence";
import { answerContinuation } from "./continuation-service";
import {
  directAnswer,
  parseQuickReply,
  pendingQuestion,
  questionContent,
  questionMeta,
  quickReplyLabel,
  type OnboardingQuestionMeta,
} from "./assistant-chat-model";
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const choice: OnboardingQuestionMeta = {
  type: "onboarding_question", version: 1, field: "businessType", kind: "single",
  options: [{ value: "retail", label: "Dyqan / Tregti" }, { value: "food", label: "Restorant / Bar" }],
  progress: { answered: 0, total: 6 },
};
const prose: OnboardingQuestionMeta = { ...choice, field: "customerQuestions", kind: "text", options: [] };
const yesNo: OnboardingQuestionMeta = { ...choice, field: "hasVariants", kind: "boolean", options: [{ value: "true", label: "Po" }, { value: "false", label: "Jo" }] };

afterEach(() => { delete process.env.OPENAI_API_KEY; });

describe("onboarding questions in the assistant conversation", () => {
  it("derives one stable conversation id per person and business", () => {
    const id = onboardingConversationId("b1", "u1");
    expect(isUuid(id)).toBe(true);
    expect(onboardingConversationId("b1", "u1")).toBe(id);
    expect(onboardingConversationId("b1", "u2")).not.toBe(id);
  });

  it("reads exact options, yes/no and explicit skips without a model", () => {
    expect(directAnswer(choice, "dyqan / tregti")).toEqual({ values: ["retail"] });
    expect(directAnswer(yesNo, "Po.")).toEqual({ values: ["true"] });
    expect(directAnswer(choice, "Më vonë")).toEqual({ skip: true });
    expect(directAnswer(choice, "shes këpucë")).toBeNull();
  });

  it("without AI keeps prose answers and sends other replies to the normal assistant", async () => {
    expect(await interpretAnswer(prose, "Pyetje?", "Sa kushton dërgesa? 200 lekë.")).toEqual({ text: "Sa kushton dërgesa? 200 lekë." });
    expect(await interpretAnswer(choice, "Çfarë biznesi ke?", "shto një produkt të ri")).toBe("other");
    expect(await interpretAnswer(choice, "Çfarë biznesi ke?", "Restorant / Bar")).toEqual({ values: ["food"] });
  });

  it("finds the open question only as the last message of an idle conversation", () => {
    const asked = { kind: "onboarding", meta: choice };
    expect(pendingQuestion({ conversation: { pending_request: null }, messages: [asked] })?.field).toBe("businessType");
    expect(pendingQuestion({ conversation: { pending_request: "r" }, messages: [asked] })).toBeNull();
    expect(pendingQuestion({ conversation: { pending_request: null }, messages: [asked, { kind: "user" }] })).toBeNull();
  });

  it("validates quick replies and logs them in the person's words", () => {
    expect(parseQuickReply(undefined)).toBeNull();
    expect(parseQuickReply({ field: "businessType", skip: true })).toEqual({ field: "businessType", skip: true });
    expect(() => parseQuickReply({ field: "businessType", values: [] })).toThrow();
    expect(() => parseQuickReply({ field: "businessType", values: [1] })).toThrow();
    expect(quickReplyLabel(choice, { field: "businessType", values: ["food"] })).toBe("Restorant / Bar");
    expect(quickReplyLabel(choice, { field: "businessType", skip: true })).toBe("Më vonë");
  });

  it("asks with the title and hint and carries the choices as metadata", () => {
    const question = { field: "businessType", title: "Çfarë biznesi ke?", hint: "Do ta përshtatim.", kind: "single" as const, options: choice.options, core: true };
    expect(questionContent(question, "Faleminderit.\n\n")).toBe("Faleminderit.\n\nÇfarë biznesi ke?\nDo ta përshtatim.");
    expect(questionMeta(question, { answered: 1, total: 6 })).toMatchObject({ type: "onboarding_question", field: "businessType", progress: { answered: 1 } });
  });
});

describe("answering in the conversation", () => {
  const access = { userId: "u1", businessId: "b1", modules: [], catalogSource: "internal" };
  const view = { conversation: { pending_request: null }, messages: [{ kind: "onboarding", content: "Çfarë biznesi ke?", meta: choice }] };
  const body = { conversationId: "c1", requestId: "r1", revision: 3 };
  it("stores a quick reply and asks the next question in the same turn", async () => {
    vi.mocked(readConversation).mockResolvedValue(view as never);
    vi.mocked(answerContinuation).mockResolvedValue({ question: { field: "offeringTypes", title: "Çfarë ofron?", hint: "", kind: "single", options: [], core: true }, progress: { answered: 1, total: 6 }, items: [] });
    vi.mocked(persistedTurn).mockImplementation(async (_a, _b, _input, run) => ({ ...(await run([], undefined, {})), persistence: {} }) as never);
    const result = await onboardingTurn(access, { ...body, onboarding: { field: "businessType", values: ["food"] } });
    expect(vi.mocked(persistedTurn).mock.calls[0][2]).toMatchObject({ content: "Restorant / Bar" });
    expect(answerContinuation).toHaveBeenCalledWith("b1", "businessType", { values: ["food"] });
    expect(result).toMatchObject({ message: "Faleminderit, u ruajt.\n\nÇfarë ofron?", onboarding: { question: { field: "offeringTypes" } } });
  });
  it("leaves other requests to the normal assistant", async () => {
    vi.mocked(persistedTurn).mockClear();
    vi.mocked(readConversation).mockResolvedValue(view as never);
    expect(await onboardingTurn(access, { ...body, text: "shto një produkt të ri" })).toBeNull();
    expect(persistedTurn).not.toHaveBeenCalled();
  });
  it("rejects a quick reply for a question that is no longer open", async () => {
    vi.mocked(readConversation).mockResolvedValue(view as never);
    await expect(onboardingTurn(access, { ...body, onboarding: { field: "teamSize", values: ["solo"] } })).rejects.toThrow("nuk është më e hapur");
  });
});
