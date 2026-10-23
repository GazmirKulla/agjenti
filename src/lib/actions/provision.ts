import { createHash, randomBytes } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { parseProvisionInput } from "./catalog";
import { requireActionAccess } from "./access";
import { isIsolatedExecution, refuseIsolatedEffect, assertBusinessEffectAllowed } from "@/lib/runtime/execution-context";
export const invitationHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const validInvitationToken = (token: string) =>
  /^[A-Za-z0-9_-]{43}$/.test(token);
export type ProvisionResult = {
  businessId: string;
  invitationUrl: string;
  expiresAt: string;
};
export async function provisionBusiness(p: {
  businessId: string;
  userId: string | null;
  requestId: string;
  input: Record<string, unknown>;
  workflowVersionId?: string;
  nodeId?: string;
  conversationId?: string;
  guard?: import("@/lib/calendar/service").BookingEffectGuard;
}): Promise<ProvisionResult> {
  assertBusinessEffectAllowed("business.provision");
  if (isIsolatedExecution()) refuseIsolatedEffect("action.provision");
  const input = parseProvisionInput(p.input);
  await requireActionAccess(
    p.businessId,
    p.userId,
    "business.provision",
    Boolean(p.workflowVersionId),
  );
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!origin || !/^https?:\/\//.test(origin))
    throw new Error("Konfiguro adresën publike të aplikacionit për ftesat.");
  const token = randomBytes(32).toString("base64url");
  const db = createServiceSupabase();
  const { data, error } = await db.rpc("provision_business_invitation", {
    p_source: p.businessId,
    p_user: p.userId,
    p_request: p.requestId,
    p_input: input,
    p_token_hash: invitationHash(token),
    p_token_ciphertext: encryptSecret(token),
    p_guard: p.guard ?? null,
    p_version: p.workflowVersionId ?? null,
    p_node: p.nodeId ?? null,
    p_conversation: p.conversationId ?? null,
  });
  if (error || !data) {
    // Never overwrite a committed success after a lost RPC response. Retrying
    // this same request may safely complete a previously failed attempt.
    try {
      await db
        .from("action_executions")
        .upsert(
          {
            business_id: p.businessId,
            action_key: "business.provision",
            request_key: p.requestId,
            actor_id: p.userId,
            workflow_version_id: p.workflowVersionId ?? null,
            node_id: p.nodeId ?? null,
            conversation_id: p.conversationId ?? null,
            input,
            status: error?.code?.length === 5 ? "failed" : "uncertain",
            result: { error: "Përgatitja nuk u konfirmua." },
          },
          {
            onConflict: "business_id,action_key,request_key",
            ignoreDuplicates: true,
          },
        );
    } catch {
      /* Preserve the original failure; never claim persistence. */
    }
    throw new Error(
      error?.message.includes("action_limit")
        ? "Kufiri mujor i këtij veprimi është arritur."
        : "Biznesi nuk u konfirmua. Riprovo të njëjtën kërkesë ose kontrollo ftesat.",
    );
  }
  if (data.status !== "pending")
    throw new Error(
      "Ftesa ekzistuese është pranuar, anuluar ose ka skaduar. Kontrollo ftesat.",
    );
  return {
    businessId: data.business_id,
    invitationUrl: `${origin}/join?request=${decryptSecret(data.token_ciphertext)}`,
    expiresAt: data.expires_at,
  };
}
