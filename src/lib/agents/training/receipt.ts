import { decryptSecret, encryptSecret } from "@/lib/crypto/tokens";
const PURPOSE = "agjenti-training-turn-v1";
type Receipt = { purpose: typeof PURPOSE; userId: string; businessId: string; expiresAt: number; question: string; response: string; workflowId: string | null; stepKey: string | null };
export function issueTrainingReceipt(userId: string, businessId: string, question: string, response: string, workflowId: string | null, stepKey: string | null | undefined) {
  return encryptSecret(JSON.stringify({ purpose: PURPOSE, userId, businessId, expiresAt: Date.now() + 60 * 60 * 1000, question: question.slice(0, 2000), response: response.slice(0, 3000), workflowId, stepKey: stepKey ?? null } satisfies Receipt));
}
export function readTrainingReceipt(token: string, userId: string, businessId: string): Receipt {
  try {
    if (typeof token !== "string" || token.length > 32000) throw new Error();
    const receipt = JSON.parse(decryptSecret(token)) as Receipt;
    if (receipt.purpose !== PURPOSE || receipt.userId !== userId || receipt.businessId !== businessId || !Number.isFinite(receipt.expiresAt) || receipt.expiresAt <= Date.now() || typeof receipt.question !== "string" || typeof receipt.response !== "string") throw new Error();
    return receipt;
  } catch { throw new Error("Përgjigjja e provës ka skaduar ose është ndryshuar. Provoje përsëri."); }
}
