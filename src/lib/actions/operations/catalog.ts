/** Shared operation metadata. Adding a definition exposes it to the owner assistant;
 * execution remains a server handler with fresh authorization and confirmation. */
export const operationCatalog = {
  "knowledge.save": { title: "Ruaj njohurinë", module: "knowledge", fields: ["id", "title", "body", "is_active", "intent_key"], description: "Create or patch business knowledge through the manual editor writer. Existing records preserve omitted fields. intent_key can be set at creation; existing intent keys remain unchanged." },
  "attention.configure": { title: "Ndrysho ndjekjen e punëve", module: "settings", fields: ["enabled"], description: "Enable or disable daily in-app notifications about changed actionable issues for the current owner. Never performs business actions automatically." },
  "product.create": { title: "Krijo produktin", module: "products", fields: ["name", "description", "sku", "image_url", "price_amount", "currency", "product_type_id", "workflow_id", "is_active"], description: "Create a product through the same validated writer as the manual editor. Inactive unless explicitly requested; activation requires price/currency/type." },
  "service.save": { title: "Ruaj shërbimin", module: "services", fields: ["id", "name", "description", "category", "price_amount", "currency", "price_mode", "booking_enabled", "duration_minutes", "buffer_minutes", "is_active", "hours"], description: "Create (omit id) or patch a service. Preserve unspecified fields. New service inactive unless explicitly requested; booking configuration remains separate." },
  "product.remove": { title: "Hiq produktet", module: "products", fields: ["scope", "ids", "query", "status"], description: "ONE reviewed batch of 1–100 products, including requests above 10 products. scope all resolves the complete unarchived catalog server-side; listed resolves the catalog query/status; ids uses explicit verified IDs. Server checks history and shows exact deletions and archives BEFORE confirmation. Never copy a partial model-context list for all/listed. Never ask again which products when scope is clear." },
  "product.delete": { title: "Fshi produktin", module: "products", fields: ["id"], description: "Delete an unused product. Referenced products must be archived instead." },
  "product.archive": { title: "Arkivo produktin", module: "products", fields: ["id"], description: "Archive a product, disable discovery and preserve its history." },
  "product.restore": { title: "Rikthe produktin", module: "products", fields: ["id"], description: "Restore an archived product as an inactive draft." },
  "product.edit": { title: "Ndrysho produktin", module: "products", fields: ["id", "name", "description", "sku", "image_url", "price_amount", "currency", "product_type_id", "workflow_id", "is_active"], description: "Update explicit product fields, including activation/deactivation. Preserve unspecified fields. Type/workflow IDs must come from verified catalog data." },
  "product.field": { title: "Ndrysho konfigurimin e produktit", module: "products", fields: ["id", "field", "value"], description: "Same operation as the catalog quick edit. field: workflow_id, product_type_id, is_active. Removing a required type demotes the product to draft. workflow_id may be a verified visual:<revision>:<flow> selection; this saves a draft binding without publication." },
  "product.bulk": { title: "Përditëso produktet e zgjedhura", module: "products", fields: ["ids", "mode", "productTypeId", "workflowId"], description: "Configure 1–100 explicit product IDs. mode: map, activate, draft. map sets supplied productTypeId/workflowId; omitted or null fields stay unchanged. Activation never publishes a workflow." },
  "calendar.settings": { title: "Ndrysho orarin e rezervimeve", module: "bookings", fields: ["timezone", "hours", "closed_dates", "confirmation_mode", "agent_booking_enabled"], description: "Patch booking settings. hours is [{day:0..6,start:HH:mm,end:HH:mm}], closed_dates is YYYY-MM-DD[]. Modes manual/automatic. Preserve unspecified settings." },
  "booking.sync": { title: "Riprovo sinkronizimin", module: "bookings", fields: ["id"], description: "Retry synchronization of an existing booking; never recreate it." },
  "agent.communication": { title: "Konfiguro komunikimin", module: "agents", fields: ["id", "mode", "instructions", "communication", "revision"], description: "Versioned customer-agent communication. mode draft prepares instructions and/or communication preferences; never changes live replies. communication accepts language customer/sq/en, tone warm/neutral/formal, length concise/balanced, questions when_needed/on_request, emoji none/light. mode publish publishes the saved draft ONLY on explicit owner request; no inline changes. mode restore with revision prepares an old version as a draft; mode discard removes the draft. Existing confirmations and business permissions remain unchanged." },
  "agent.manage": { title: "Konfiguro agjentin", module: "agents", fields: ["id", "name", "instructions", "is_active"], description: "Create an agent with initial instructions (omit id), or change an existing agent's name/activation. Existing instructions MUST use agent.communication draft and publish. Activation switches the active agent. Respect the existing agent limit." },
  "business.autoreply": { title: "Ndrysho përgjigjet automatike", module: "agents", fields: ["enabled"], description: "Set business auto_reply to an explicit boolean. Does not activate agents or publish workflows." },
  "training.save": { title: "Ruaj mësimin e agjentit", module: "agents", fields: ["id", "revision", "kind", "instruction", "customerMessage", "desiredResponse", "workflowId", "stepKey", "visualFlowId", "visualNodeId"], description: "Save training. kind: style, example, workflow. Examples require customerMessage and desiredResponse; existing lessons require id/revision. Never forge test receipts." },
  "training.change": { title: "Ndrysho mësimin e agjentit", module: "agents", fields: ["id", "revision", "action"], description: "Change existing training: action enable, disable or delete, with its current revision." },
  "conversation.resume": { title: "Rifillo agjentin në bisedë", module: "inbox", fields: ["id"], description: "Resume the customer agent in the selected conversation after readiness and pending delivery checks." },
  "conversation.pause": { title: "Ndalo agjentin në bisedë", module: "inbox", fields: ["id"], description: "Pause the customer agent in this conversation for staff handling." },
  "order.reconcile": { title: "Regjistro verifikimin e porosisë", module: "orders", fields: ["conversationId", "orderId", "status", "externalOrderId", "evidence"], description: "Record evidence explicitly supplied by staff for an uncertain order. status accepted/rejected; accepted requires verified externalOrderId. Never invent evidence or resend the order." },
  "order.submit": { title: "Dërgo porosinë e konfirmuar", module: "orders", fields: ["conversationId"], description: "Submit an already customer-confirmed order. Does not manufacture customer consent. Existing submission/idempotency safeguards apply." },
} as const;
export type OperationKey = keyof typeof operationCatalog;
export type OperationInput = Record<string, unknown>;
export function isOperationKey(value: unknown): value is OperationKey {
  return typeof value === "string" && Object.hasOwn(operationCatalog, value);
}
export function parseOperation(key: unknown, input: unknown): { key: OperationKey; input: OperationInput } {
  if (!isOperationKey(key) || !input || typeof input !== "object" || Array.isArray(input)) throw Error("Veprimi nuk është i vlefshëm.");
  const fields: readonly string[] = operationCatalog[key].fields;
  if (Object.keys(input).some(field => !fields.includes(field)) || JSON.stringify(input).length > 24000)
    throw Error("Veprimi përmban fusha të palejuara.");
  return { key, input: input as OperationInput };
}
export function assistantOperationCatalog() {
  return Object.entries(operationCatalog).map(([key, value]) => ({ key, ...value, confirmation: "required", audience: "business_owner" }));
}
