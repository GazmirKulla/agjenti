import type { CapabilityAssessment } from "@/lib/capabilities/registry";

/** Presentation contract only; each capability retains its own authorized writer. */
export type CapabilityActivationResult = {
  status: "available" | "ready" | "disabled" | "unauthorized" | "unsupported" | "blocked" | "activated" | "unverified";
  message: string;
  assessment?: CapabilityAssessment;
  /** Acknowledged write; null means the write outcome is unknown. */
  changed: boolean | null;
  partial?: boolean;
  options?: { id: string; name: string; detail?: string; price?: number | null; currency?: string; token?: string; blocker?: string }[];
};
export type ActivationActor = { userId: string; businessId: string; slug: string; catalogSource: string };
