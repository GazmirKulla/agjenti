export type VisualNodeKind = "action" | "start" | "condition" | "knowledge" | "order_status" | "collect" | "confirm" | "product" | "booking" | "handoff" | "end";
export type VisualPort = "next" | "yes" | "no";
export type VisualIntent = "order" | "booking" | "support" | "question" | "unknown";
export type VisualNode = {
  id: string;
  kind: VisualNodeKind;
  label: string;
  position: { x: number; y: number };
  config: {
    action?: import("@/lib/actions/catalog").ActionBinding;
    prompt?: string;
    fieldKey?: string;
    fieldType?: "text" | "email" | "phone" | "number" | "photo";
    condition?: "intent_order" | "intent_booking" | "intent_support" | "field_present" | "field_equals";
    value?: string;
  };
};
export type VisualEdge = { id: string; source: string; target: string; port: VisualPort };
export type VisualFlowKind = "order" | "booking" | "information" | "support" | "custom";
export type VisualFlow = { id: string; label: string; kind: VisualFlowKind; entryNodeId: string; nodeIds: string[]; productIds?: string[]; serviceIds?: string[] };
type VisualGraphBody = { name: string; nodes: VisualNode[]; edges: VisualEdge[] };
export type VisualGraphV2 = VisualGraphBody & { version: 2; flows: VisualFlow[] };
export type VisualGraph = (VisualGraphBody & { version: 1 }) | VisualGraphV2;
export type VisualRunState = {
  binding?: { flowId: string; entity: { kind: "product" | "service"; id: string } };
  branchPorts?: Record<string, "yes" | "no">;
  versionId: string;
  nodeId: string;
  status: "running" | "waiting" | "completed" | "handoff";
  visited: string[];
  values: Record<string, string>;
  actionResults?: Record<string, Record<string, string>>;
  awaiting: boolean;
  pendingConfirmation?: { nodeId: string; factsKey: string; expiresAt: number };
  confirmedConfirmation?: { nodeId: string; factsKey: string; expiresAt: number; answer: "po" | "jo" };
  forceCollect?: string;
  advisory?: boolean;
};
/** Execution evidence only; never includes collected values or prompt content. */
export type VisualFieldValidation = {
  nodeId: string;
  fieldKey: string;
  fieldType: NonNullable<VisualNode["config"]["fieldType"]>;
  status: "accepted" | "invalid" | "reused" | "not_consumed";
  reasonCode: "validated_input" | "invalid_value" | "canonical_value" | "question" | "input_already_consumed" | "prompt_not_yet_presented";
};
export type VisualExecution = {
  state: VisualRunState;
  action: { kind: "action" | "knowledge" | "order_status" | "product" | "booking" | "prompt" | "handoff" | "end"; nodeId: string; message?: string };
  traversedNodeIds: string[];
  inputConsumed: boolean;
  fieldValidation?: VisualFieldValidation[];
  error?: string;
};
export type VisualVersion = { id: string; businessId: string; graph: VisualGraph; createdAt: string };
export type VisualWorkspace = {
  graph: VisualGraph;
  revision: number;
  publishedVersionId: string | null;
  enabled: boolean;
  available: boolean;
  generated: boolean;
  hasUnpublishedChanges?: boolean;
};
export type VisualTrace = { graph: VisualGraph; state: VisualRunState; traversedNodeIds: string[]; routing?: {action:string;from:string|null;to:string;source:"rules"|"ai"} };
