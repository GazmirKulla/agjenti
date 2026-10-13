import { AssistantError } from "./model";

/** Model-authored intent only. Server assessments and approvals are separate. */
export type AutomationIntent = {
  requestedBehaviors: { description: string; capabilityKeys: string[] }[];
  assumptions: string[];
  clarificationQuestions: string[];
};

const strings = { type: "array", maxItems: 16, items: { type: "string", maxLength: 500 } };
export const automationIntentSchema = {
  type: ["object", "null"], additionalProperties: false,
  required: ["requestedBehaviors", "assumptions", "clarificationQuestions"],
  properties: {
    requestedBehaviors: { type: "array", minItems: 1, maxItems: 16, items: {
      type: "object", additionalProperties: false, required: ["description", "capabilityKeys"],
      properties: { description: { type: "string", maxLength: 500 }, capabilityKeys: strings },
    } },
    assumptions: strings, clarificationQuestions: strings,
  },
};

export function readAutomationIntent(raw: unknown): AutomationIntent | undefined {
  if (raw == null) return undefined;
  const invalid = () => { throw new AssistantError("Propozimi i automatizimit nuk është i vlefshëm."); };
  const list = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 16 && v.every(s => typeof s === "string" && s.trim().length > 0 && s.length <= 500);
  if (typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const v = raw as AutomationIntent;
  if (!Array.isArray(v.requestedBehaviors) || !v.requestedBehaviors.length || v.requestedBehaviors.length > 16 || !list(v.assumptions) || !list(v.clarificationQuestions)) return invalid();
  for (const b of v.requestedBehaviors) {
    if (!b || typeof b.description !== "string" || !b.description.trim() || b.description.length > 500 || !list(b.capabilityKeys)) return invalid();
  }
  return { requestedBehaviors: v.requestedBehaviors.map(b => ({ description: b.description, capabilityKeys: [...new Set(b.capabilityKeys)] })), assumptions: v.assumptions, clarificationQuestions: v.clarificationQuestions };
}
