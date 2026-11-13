import type { ReferenceProduct } from "@/lib/products/entity-bridge";
import type { TraceObserver } from "./trace";
import type { ConversationStatePayload, WorkflowProgressItem, WorkflowStepDef } from "@/lib/workflows/engine";

export type AgentTurnResult = {
  /** Server-owned delivery envelope. Never supplied by a customer or model. */
  processCheckpoint?: { event: import("@/lib/orchestration/contracts").CustomerEvent; expectedRevision: number; targetIds: string[] };
  preparedRequest?: import("./prepared-request").PreparedRequest;
  /** Authorized test entry points only; observation, never permission or behavioral proof. */
  configuration?: import("@/lib/agents/configuration-contract").TestConfigurationProvenance;
  /** Server-rendered catalog references in reply; finalized by the coordinator. */
  presentedProducts?: ReferenceProduct[];
  presentedServices?: ReferenceProduct[];
  visualWorkflow?: import("@/lib/workflows/visual/types").VisualTrace;
  /** Isolated/Chat Lab only. Live turns omit this; never treat SIMULATED as a real write. */
  externalActions?: import("@/lib/runtime/execution-context").ExternalAction[];
  handoff?: boolean;
  advisoryHandoff?: boolean;
  reply: string;
  nextState: ConversationStatePayload;
  previousResponseId: string | null;
  workflowId: string | null;
  productName: string | null;
  workflowProgress: WorkflowProgressItem[];
  debug: {
    model: string;
    source: "ai" | "fallback";
    fallbackReason: string | null;
    agentConfigured: boolean;
    knowledgeCount: number;
    /** Titles of the knowledge given to the agent for this reply (the most relevant ones). */
    knowledgeTitles?: string[];
    productCount: number;
    workflowSteps: string[];
    elapsedMs: number;
    retrievedCatalogIds?: string[];
    retrievedService?: boolean;
    trainingMemoryIds?: string[];
  };
};

export type AgentTurnParams = {
  customerIdentity?: import("@/lib/orders/own-orders").OrderCustomerIdentity;
  /** Injected only by the authenticated queue worker. */
  processTransport?: import("@/lib/calendar/service").BookingEffectGuard;
  configurationPreview?: import("@/lib/agents/communication-configuration").AgentConfigurationPreview;
  /** Coordinator-resolved hint, revalidated against the active tenant catalog by adapters. Never a customer API input. */
  selectedProductId?: string;
  selectedServiceId?: string;
  /** Server-read latest outbound message; never supplied by a customer. */
  deliveredReply?: string | null;
  /** Set only by the validated visual executor, never from a client request. */
  trainingVisualScope?: { flowId: string; nodeId: string };
  /** Server-owned, customer-scoped lookup; previews receive an isolated implementation. */
  orderStatusTurn?: (state: ConversationStatePayload) => Promise<AgentTurnResult>;
  orderStatusRequest?: boolean;
  /** Only supplied by the server coordinator; graph previews use the same isolated adapter. */
  bookingTurn?: (state: ConversationStatePayload) => Promise<AgentTurnResult | null>;
  bookingRequest?: boolean;
  bookingNavigation?: boolean;
  informationRequest?: boolean;
  supportRequest?: boolean;
  /** Server-verified excerpts from the isolated test chat; never persisted to CRM. */
  attachmentContext?: string;
  hasAttachments?: boolean;
  /** Trusted conversation_states.workflow_id, supplied only by the inbound server. */
  persistedWorkflowId?: string | null;
  linearPreview?: boolean;
  linearPreviewDefinition?: { versionId: string; workflowId: string; name: string; steps: WorkflowStepDef[]; productId: string };
  /** A routed order request is not an answer to the pending product field. */
  orderRequest?: boolean;
  visualPreview?: import("@/lib/workflows/visual/types").VisualVersion;
  /** Immutable version selected by the server entity router; never accepted from client payloads. */
  entityVersion?: import("@/lib/workflows/visual/types").VisualVersion | null;
  onTrace?: TraceObserver;
  /** Chat Lab only: the prospect read done before the isolated turn (test mode). */
  prospectPreview?: unknown;
  actionFlowRequest?: boolean;
  /** Server-resolved navigation options, never effect permission. */
  processOffers?: { flowId: string; label: string; versionId: string }[];
  requestedActionFlow?: string;
  actionGuard?: import("@/lib/calendar/service").BookingEffectGuard;
  mode?: "production" | "test";
  source?: "instagram" | "whatsapp" | "admin_chat_lab" | "panel";
  businessId: string;
  message: string;
  hasPhoto: boolean;
  state?: ConversationStatePayload | null;
  previousResponseId?: string | null;
};
/** Public call signatures delegate to the single coordinator; no alternate engine. */
export async function processAgentTurn(params: AgentTurnParams): Promise<AgentTurnResult> {
  const { processConversationMessage } = await import("./process-conversation-message");
  return processConversationMessage(params);
}
