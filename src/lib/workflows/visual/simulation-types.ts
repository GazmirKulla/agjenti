/** Client-safe evidence contract. No prompts, credentials or real customer data. */
export type SimulationStatus = "PASS" | "FAIL" | "BLOCKED" | "UNVERIFIED";
export type SimulationBinding = {
  version: 1;
  proposalId: string;
  baseRevision: number;
  candidateGraphHash: string;
};
export type SimulationFinding = { code: string; message: string; nodeId?: string };
export type ScenarioResult = {
  scenarioId: string;
  description: string;
  critical: boolean;
  category: "happy_path" | "alternative" | "missing_input" | "ambiguous_input" | "existing_values" | "capability" | "regression" | "coverage";
  inputMessages: string[];
  /** Synthetic fixtures only; configuration-derived values are redacted. */
  initialState: { nodeId: string | null; awaiting: boolean; values: Record<string, string>; intent: string };
  expectedOutcome: string;
  actualOutcome: string;
  traversedNodeIds: string[];
  selectedBranches: Record<string, "yes" | "no">;
  collectedFields: { nodeId: string; value: string }[];
  attemptedActions: { nodeId: string; kind: string; disposition: "not_executed" }[];
  validationFindings: SimulationFinding[];
  executionCount: number;
  durationMs: number;
  result: SimulationStatus;
};
export type SimulationReport = SimulationBinding & {
  engine: "visual-runtime-v1";
  baselineGraphHash: string;
  scenarios: ScenarioResult[];
  validationFindings: SimulationFinding[];
  durationMs: number;
  result: SimulationStatus;
  /** True only when every critical scenario has independent expectations and execution evidence. */
  canPublish: boolean;
};
