export type CapabilityCategory = "knowledge" | "catalog" | "orders" | "booking" | "staff";
export type CapabilityRisk = "read" | "write" | "external_effect";
export type CapabilityApprovalPolicy = "none" | "confirmation";
export type CapabilityReadiness = "ready" | "needs_setup" | "unsupported" | "needs_clarification";

export type CapabilityDefinition = {
  key: string;
  description: string;
  category: CapabilityCategory;
  inputSchema: Record<string, string>;
  requiredModules: string[];
  requiredIntegrations: string[];
  risk: CapabilityRisk;
  approvalPolicy: CapabilityApprovalPolicy;
  executorId: string;
};

export type CapabilityAssessment = {
  capabilityKey: string;
  status: CapabilityReadiness;
  reasonCode: string;
  missingRequirements: string[];
  evidence?: string[];
  safeAlternative?: string;
};

/** Platform capabilities with verified handlers in the current runtime. */
export const capabilityRegistry: Record<string, CapabilityDefinition> = {
  "knowledge.answer": {
    key: "knowledge.answer",
    description: "Përgjigjet nga njohuritë aktive të biznesit.",
    category: "knowledge",
    inputSchema: { message: "string" },
    requiredModules: ["knowledge"],
    requiredIntegrations: [],
    risk: "read",
    approvalPolicy: "none",
    executorId: "conversation.knowledge",
  },
  "product.search": {
    key: "product.search",
    description: "Kërkon produkte aktive në katalogun e biznesit.",
    category: "catalog",
    inputSchema: { query: "string" },
    requiredModules: ["products"],
    requiredIntegrations: [],
    risk: "read",
    approvalPolicy: "none",
    executorId: "catalog.product_search",
  },
  "product.recommend": {
    key: "product.recommend",
    description: "Sugjeron produkte nga katalogu i verifikuar.",
    category: "catalog",
    inputSchema: { query: "string", constraints: "object?" },
    requiredModules: ["products"],
    requiredIntegrations: [],
    risk: "read",
    approvalPolicy: "none",
    executorId: "catalog.product_recommend",
  },
  "order.status.read": {
    key: "order.status.read",
    description: "Lexon vetëm statusin e porosive të klientit të bisedës.",
    category: "orders",
    inputSchema: { conversationId: "string" },
    requiredModules: ["orders", "workflows"],
    requiredIntegrations: [],
    risk: "read",
    approvalPolicy: "none",
    executorId: "conversation.order_status",
  },
  "booking.availability.read": {
    key: "booking.availability.read",
    description: "Kontrollon oraret e lira për një shërbim aktiv.",
    category: "booking",
    inputSchema: { serviceId: "uuid", date: "date" },
    requiredModules: ["bookings"],
    requiredIntegrations: [],
    risk: "read",
    approvalPolicy: "none",
    executorId: "calendar.available_slots",
  },
  "booking.create": {
    key: "booking.create",
    description: "Krijon një rezervim pasi serveri verifikon shërbimin dhe orarin.",
    category: "booking",
    inputSchema: { serviceId: "uuid", customer: "object", startsAt: "datetime" },
    requiredModules: ["bookings"],
    requiredIntegrations: [],
    risk: "external_effect",
    approvalPolicy: "confirmation",
    executorId: "calendar.save_booking",
  },
  "staff.handoff": {
    key: "staff.handoff",
    description: "Ndalon përgjigjet automatike dhe ia kalon bisedën stafit.",
    category: "staff",
    inputSchema: { conversationId: "string", reason: "string?" },
    requiredModules: ["staff"],
    requiredIntegrations: [],
    risk: "write",
    approvalPolicy: "none",
    executorId: "conversation.staff_handoff",
  },
};

export function getCapability(key: string) {
  return Object.hasOwn(capabilityRegistry, key) ? capabilityRegistry[key] : undefined;
}
