export type VisualNodeKind = "start" | "condition" | "knowledge" | "collect" | "confirm" | "product" | "handoff" | "end";
export type VisualPort = "next" | "yes" | "no";
export type VisualIntent = "order" | "support" | "question" | "unknown";
export type VisualNode = {
  id: string;
  kind: VisualNodeKind;
  label: string;
  position: { x: number; y: number };
  config: {
    prompt?: string;
    fieldKey?: string;
    fieldType?: "text" | "email" | "phone" | "number" | "photo";
    condition?: "intent_order" | "intent_support" | "field_present" | "field_equals";
    value?: string;
  };
};
export type VisualEdge = { id: string; source: string; target: string; port: VisualPort };
export type VisualGraph = { version: 1; name: string; nodes: VisualNode[]; edges: VisualEdge[] };
export type VisualRunState = {
  versionId: string;
  nodeId: string;
  status: "running" | "waiting" | "completed" | "handoff";
  visited: string[];
  values: Record<string, string>;
  awaiting: boolean;
};
export type VisualExecution = {
  state: VisualRunState;
  action: { kind: "knowledge" | "product" | "prompt" | "handoff" | "end"; nodeId: string; message?: string };
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
export type VisualTrace = { graph: VisualGraph; state: VisualRunState; traversedNodeIds: string[] };
