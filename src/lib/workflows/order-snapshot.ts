import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import type { WorkflowStepDef } from "./engine";
type OrderSnapshot = {
  purpose: "order-workflow-v1";
  businessId: string;
  productId: string;
  workflowId: string;
  name: string;
  steps: WorkflowStepDef[];
};
export function sealOrderSnapshot(snapshot: Omit<OrderSnapshot, "purpose">) {
  // Existing installations without assistant encryption continue to run unchanged.
  if (!process.env.TOKEN_ENCRYPTION_KEY?.trim()) return undefined;
  return encryptSecret(
    JSON.stringify({ ...snapshot, purpose: "order-workflow-v1" }),
  );
}
export function readOrderSnapshot(
  token: string | undefined,
  businessId: string,
  productId: string,
) {
  if (!token) return null;
  try {
    if (typeof token !== "string" || token.length > 64000) throw new Error();
    const snapshot = JSON.parse(decryptSecret(token)) as OrderSnapshot;
    if (
      snapshot.purpose !== "order-workflow-v1" ||
      snapshot.businessId !== businessId ||
      snapshot.productId !== productId ||
      !snapshot.workflowId ||
      !Array.isArray(snapshot.steps)
    )
      throw new Error();
    return snapshot;
  } catch {
    throw new Error(
      "Versioni i porosisë nuk u verifikua. Kërko ndihmën e stafit.",
    );
  }
}
