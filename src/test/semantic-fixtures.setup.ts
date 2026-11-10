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
vi.mock("@/lib/conversations/fragment-observation", async original => ({
 ...await original<typeof import("@/lib/conversations/fragment-observation")>(),
 interpretFragment: async (text: string) => lookup(fragments, text),
}));

// Workflow authoring tests isolate interpretation from server policy. Provider
// contract tests unmock this boundary; semantic cases set explicit observations.
vi.mock("@/lib/capabilities/workflow-semantics", async original => ({
  // The prompt text stays real for the admin prompt catalog.
  WORKFLOW_CAPABILITY_REVIEW_PROMPT: (await original<typeof import("@/lib/capabilities/workflow-semantics")>()).WORKFLOW_CAPABILITY_REVIEW_PROMPT,
  reviewWorkflowSemantics: vi.fn(async () => ({ capabilityKeys: [], evidence: [] })),
  withWorkflowSemanticReviews: <T>(run: () => Promise<T>) => run(),
  WorkflowSemanticReviewError: class extends Error {},
}));

// Labelled candidate observations isolate routing from provider quality. These
// are fixture data only; real-model and schema tests exercise the actual boundary.
vi.mock("@/lib/conversations/understanding/selection", async original => {
  const actual = await original<typeof import("@/lib/conversations/understanding/selection")>();
  const { createHash } = await import("node:crypto");
  const { default: fixtures } = await import("./fixtures/selection.json");
  return { ...actual, selectSemanticCandidates: vi.fn(async (kind: string, entries: unknown[], message: string) => {
    if (!entries.length || !message.trim()) return [];
    const key = createHash("sha256").update(JSON.stringify([kind, entries, message])).digest("hex");
    const fixture = (fixtures as Record<string, { matches: unknown }>)[key];
    if (!fixture) { missingFixtures.push(`semantic selection ${JSON.stringify([kind, entries, message])}`); throw new Error("Missing labelled selection fixture"); }
    return structuredClone(fixture.matches);
  }) };
});
