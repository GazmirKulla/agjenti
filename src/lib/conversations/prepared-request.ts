export type PreparedRequest = {
  domain: "order" | "service" | "booking";
  entity: { id: string; kind: "product" | "service"; name: string };
  collectedFields: Record<string, string>;
  missingFields: string[];
  validation: "incomplete" | "valid" | "unverified";
  review: "collecting" | "ready_for_review" | "review_requested" | "customer_confirmed";
  // A returned nextState is not proof that the transport committed ownership.
  handoff: "not_handed_off" | "requested";
  source: { versionId: string; flowId: string; policyRevision: number };
  /** Manual staff actions are separate and are not inferred from process state. */
  transaction: "not_executed_by_agent";
};
