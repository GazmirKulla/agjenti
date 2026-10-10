export type VisualNodeKind = "start" | "condition" | "knowledge" | "collect" | "confirm" | "product" | "booking" | "handoff" | "end";
export type VisualPort = "next" | "yes" | "no";
export type VisualIntent = "order" | "booking" | "support" | "question" | "unknown";
export type VisualNode = {
  id: string;
  kind: VisualNodeKind;
  label: string;
  position: { x: number; y: number };
  config: {
    prompt?: string;
    fieldKey?: string;
    fieldType?: "text" | "email" | "phone" | "number" | "photo";
    condition?: "intent_order" | "intent_booking" | "intent_support" | "field_present" | "field_equals";
    value?: string;
  };
};
export type VisualEdge = { id: string; source: string; target: string; port: VisualPort };
export type VisualFlowKind = "order" | "booking" | "information" | "support" | "custom";
export type VisualFlow = { id: string; label: string; kind: VisualFlowKind; entryNodeId: string; nodeIds: string[] };
type VisualGraphBody = { name: string; nodes: VisualNode[]; edges: VisualEdge[] };
export type VisualGraphV2 = VisualGraphBody & { version: 2; flows: VisualFlow[] };
export type VisualGraph = (VisualGraphBody & { version: 1 }) | VisualGraphV2;
export type VisualRunState = {
  versionId: string;
  nodeId: string;
  status: "running" | "waiting" | "completed" | "handoff";
  visited: string[];
  values: Record<string, string>;
  awaiting: boolean;
  forceCollect?: string;
  advisory?: boolean;
};
export type VisualExecution = {
  state: VisualRunState;
  action: { kind: "knowledge" | "product" | "booking" | "prompt" | "handoff" | "end"; nodeId: string; message?: string };
  traversedNodeIds: string[];
  inputConsumed: boolean;
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
