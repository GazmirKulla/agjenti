import type { SimulationBinding, SimulationStatus } from "./simulation-types";

export type PublicationApproval = SimulationBinding & {
  businessId: string;
  userId: string;
  requestId: string;
  expires: number;
  publishedVersionId: string | null;
};
export type PublicationReadiness = {
  mode: "assistant_strict" | "manual_legacy";
  result: SimulationStatus;
  status: "ready" | "needs_setup" | "simulation_failed" | "unverified_external_action" | "stale_proposal" | "approval_required" | "blocked";
  canRequestApproval: boolean;
  canPublish: boolean;
  baseRevision: number;
  candidateGraphHash: string | null;
  findings: import("@/lib/capabilities/diagnostics").ReadinessFinding[];
};
export type PublicationReceipt = {
  revision: number;
  publishedVersionId?: string;
  publishedAt?: string;
  actorId?: string;
  warning?: string;
};
