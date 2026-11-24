import type { ConfigurationStep } from "@/lib/actions/operations/configuration-policy";

/** Field contracts, never natural-language intent detection. */
export function containsAuthoredContent(step: ConfigurationStep): boolean {
  if (!step || typeof step !== "object" || !step.input || typeof step.input !== "object") return false;
  const { key, input } = step;
  if (key === "knowledge.save") return input.body !== undefined;
  if (key === "training.save") return true;
  if (key === "agent.communication" || key === "agent.manage") return input.instructions !== undefined;
  if (key !== "agent.configure" || !Array.isArray(input.changes)) return false;
  return input.changes.some(change => change && typeof change === "object" &&
    (change.type === "knowledge.save" || change.type === "training.save" ||
      (change.type === "agent.update" || change.type === "agent.draft") && change.instructions !== undefined));
}
