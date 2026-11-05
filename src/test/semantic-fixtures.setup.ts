/**
 * Frozen, labelled observations for the existing synthetic unit scenarios.
 * These replace the old unit tests' implicit reliance on phrase recognizers.
 * They are NOT model-quality assertions. Provider/schema tests unmock these
 * boundaries; the opt-in real-model suite checks language interpretation.
 * Never import these fixtures from application code.
 */
import { vi, expect, afterEach } from "vitest";
import semantics from "./fixtures/semantic.json";
import common from "./fixtures/common-semantics.json";
import reviews from "./fixtures/review.json";
import fragments from "./fixtures/fragment.json";
import { unknownUnderstanding, type MessageUnderstanding } from "@/lib/conversations/understanding/contract";
const missingFixtures: string[] = [];
afterEach(() => { const missing = missingFixtures.splice(0); expect(missing, "Every semantic unit observation must be explicitly labelled").toEqual([]); });
function lookup<T>(data: unknown, input: string): T {
  const state = expect.getState();
  const key = state.testPath!.slice(process.cwd().length + 1) + "::" + state.currentTestName;
  const entry = (data as Record<string, Record<string, T>>)[key];
  if (!entry || !Object.hasOwn(entry, input)) {
    const missing = key + " / " + JSON.stringify(input);
    missingFixtures.push(missing);
    throw new Error("Missing labelled semantic fixture: " + missing);
  }
  return structuredClone(entry[input]);
}
function meaning(message: string): MessageUnderstanding {
  if (!message.trim()) return structuredClone(unknownUnderstanding);
  const shared = common as Record<string, Partial<MessageUnderstanding>>;
  const test = expect.getState();
  const caseKey = test.testPath!.slice(process.cwd().length + 1) + "::" + test.currentTestName;
  const specific = (semantics as unknown as Record<string, Record<string, Partial<MessageUnderstanding>>>)[caseKey]?.[message];
  return { ...structuredClone(unknownUnderstanding), ...(specific ? structuredClone(specific) : Object.hasOwn(shared,message) ? structuredClone(shared[message]) : lookup<Partial<MessageUnderstanding>>(semantics, message)) };
}
vi.mock("@/lib/conversations/understanding/context", async original => {
  const actual = await original<typeof import("@/lib/conversations/understanding/context")>();
  return { ...actual, messageUnderstanding(message: string) {
    return actual.hasUnderstandingContext() ? actual.messageUnderstanding(message) : meaning(message);
  } };
});
vi.mock("@/lib/conversations/understanding/interpret", async original => {
  const actual = await original<typeof import("@/lib/conversations/understanding/interpret")>();
  return { ...actual, interpretMessage: async (message: string) => meaning(message) };
});
vi.mock("@/lib/agents/response-review", async original => ({
 ...await original<typeof import("@/lib/agents/response-review")>(),
 reviewInformationalResponse: vi.fn(async (text: string) => lookup(reviews, text)),
}));
vi.mock("@/lib/conversations/fragment-observation", () => ({
 interpretFragment: async (text: string) => lookup(fragments, text),
}));

// Workflow authoring tests isolate interpretation from server policy. Provider
// contract tests unmock this boundary; semantic cases set explicit observations.
vi.mock("@/lib/capabilities/workflow-semantics", () => ({
  reviewWorkflowSemantics: vi.fn(async () => ({ capabilityKeys: [], evidence: [] })),
  withWorkflowSemanticReviews: <T>(run: () => Promise<T>) => run(),
  WorkflowSemanticReviewError: class extends Error {},
}));
