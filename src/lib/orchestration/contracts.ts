/** Server-owned process state. Model observations cannot supply identities, policies or receipts. */
export type Value = string | number | boolean | string[];
export type Field = {
  source?: "customer" | "server";
  id: string;
  subject: string;
  label: string;
  type: "text" | "email" | "phone" | "number" | "boolean" | "date" | "time" | "choice" | "choices" | "reference" | "photo";
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
};
export type Step =
  | { id: string; kind: "collect"; fieldId: string; prompt?: string; next: string }
  | { id: string; kind: "condition"; fieldId: string; operator: "present" | "equals"; value?: Value; yes: string; no: string }
  | { id: string; kind: "semantic_condition"; predicate: string; yes: string; no: string }
  | { id: string; kind: "confirm"; fieldIds: string[]; requiredFieldIds?: string[]; yes: string; no: string; label: string }
  | { id: string; kind: "inform"; next: string }
  | { id: string; kind: "resolve"; fieldIds: string[]; next: string }
  | { id: string; kind: "effect"; tool: string; toolVersion: number; inputs: Record<string, string>; next: string; failed: string }
  | { id: string; kind: "message"; text: string; next: string }
  | { id: string; kind: "wait"; eventType: string; timeoutMs: number; next: string; expired: string }
  | { id: string; kind: "end" | "handoff"; label: string };
export type ProcessDefinition = {
  policyKey?: string;
  collection?: { domain: "order" | "service" | "booking"; revision: number; profileFields: string[] };
  id: string;
  versionId: string;
  businessId: string;
  name: string;
  purpose: string;
  offerPolicy: "on_request" | "when_relevant";
  entry: string;
  fields: Field[];
  steps: Step[];
};
export type Fact = { value: Value; subject: string; fieldId: string; revision: number; eventId: string; evidence: string };
export type InstanceStatus = "running" | "waiting_input" | "waiting_approval" | "waiting_event" | "waiting_effect" | "suspended" | "handoff" | "completed" | "cancelled" | "failed";
export type Wait = {
  id: string;
  instanceId: string;
  stepId: string;
  kind: "field" | "approval" | "event";
  fieldId?: string;
  eventType?: string;
  expiresAt: number;
  /** Confirmed by transport, never inferred from prose or proposed by the model. */
  presentedAt?: number;
  factDigest: string;
};
export type Approval = { waitId: string; stepId: string; fieldIds: string[]; factDigest: string; eventId: string; expiresAt: number };
export type Instance = {
  productWorkflow?: { productId: string; workflowId: string | null; versionId: string | null };
  policyKey?: string;
  confirmedReviews?: Approval[];
  id: string;
  definitionId: string;
  versionId: string;
  stepId: string;
  status: InstanceStatus;
  suspendedStatus?: InstanceStatus;
  facts: Record<string, Fact>;
  visited?: string[];
  skippedFields?: Record<string, { eventId: string; evidence: string }>;
  wait?: Wait;
  approval?: Approval;
  action?: Action;
  /** Latest durable receipt per authored effect step, preserved across later effects. */
  results?: Record<string, { actionId: string; tool: string; status: Action["status"]; output: Record<string, Value> }>;
  lastError?: string;
};
export type Action = {
  id: string;
  instanceId: string;
  stepId: string;
  tool: string;
  toolVersion: number;
  input: Record<string, Value>;
  inputDigest: string;
  approvalWaitId?: string;
  approval?: Approval;
  status: "prepared" | "running" | "succeeded" | "simulated" | "failed" | "unknown";
  output?: Record<string, Value>;
};
export type Offer = { id: string; definitionId: string; versionId: string; expiresAt: number; presentedAt?: number };
export type Snapshot = {
  retrieval?: import("@/lib/catalogs/ranking").CatalogContext;
  handoffRequested?: boolean;
  history?: { role: "user" | "assistant"; content: string }[];
  pendingTurn?: { eventId: string; messageDigest: string; notices: RuntimeNotice[] };
  schemaVersion: 4;
  mode: "live" | "test";
  businessId: string;
  conversationId: string;
  revision: number;
  instances: Record<string, Instance>;
  offers: Record<string, Offer>;
  focusId: string | null;
};
export type CustomerCommand =
  | { kind: "offer"; definitionId: string; versionId: string; evidence: string }
  | { kind: "start"; definitionId: string; versionId: string; evidence: string; initialFacts: FactInput[] }
  | { kind: "accept_offer"; offerId: string; evidence: string; initialFacts: FactInput[] }
  | { kind: "decline_offer"; offerId: string; evidence: string }
  | { kind: "facts"; instanceId: string; values: FactInput[] }
  | { kind: "approve" | "decline"; instanceId: string; waitId: string; evidence: string }
  | { kind: "skip_field"; instanceId: string; waitId: string; evidence: string }
  | { kind: "suspend" | "resume" | "cancel"; instanceId: string; evidence: string };
export type ConditionObservation = { definitionId: string; versionId: string; instanceId: string | null; stepId: string; outcome: "yes" | "no" | "unclear"; evidence: string };
export type Observation = { revision: number; commands: CustomerCommand[]; conditions?: ConditionObservation[]; needsClarification: boolean };
export type FactInput = { fieldId: string; value: Value; evidence: string };
export type CustomerEvent = { id: string; businessId: string; conversationId: string; message: string; actor: "customer" };
export type RuntimeEvent = { id: string; businessId: string; conversationId: string; actor: "runtime";
  kind: "action_dispatch" | "action_result"; actionId: string; inputDigest: string; result?: { status: Action["status"]; output: Record<string, Value> } };
export type ToolPolicy = {
  key: string;
  version: number;
  effect: "read" | "write";
  approval: "none" | "required";
  allowed: boolean;
  inputs: { key: string; type: Field["type"]; required: boolean; options?: string[]; min?: number; max?: number }[];
};
export type RuntimeNotice = { kind: "question" | "approval" | "offer" | "message" | "completed" | "handoff" | "blocked" | "clarify"; instanceId?: string; targetId?: string; field?: Field; text?: string; reason?: string };
export type Transition = { state: Snapshot; notices: RuntimeNotice[]; actions: Action[] };
export class TransitionError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function initialSnapshot(businessId: string, conversationId: string, mode: Snapshot["mode"]): Snapshot {
  return { schemaVersion: 4, mode, businessId, conversationId, revision: 0, instances: {}, offers: {}, focusId: null };
}
