"use server";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { prepareOperation, executeOperation, type PreparedOperation } from "./service";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { revalidatePath } from "next/cache";
import { resumeOperationPlan, executeOperationPlan, type PreparedPlan } from "./plans";
export async function prepareManualOperation(slug: string, key: string, input: Record<string, unknown>) {
  try {
    const user = await getSessionUser(); const access = user ? await requireBusinessAccess(user.id, slug) : null;
    if (!user || !access) throw Error("Nuk ke qasje në këtë biznes.");
    const plan = key === "plan.resume" ? await resumeOperationPlan(access.business.id, user.id, String(input.id)) : undefined;
    const operation = plan ? undefined : await prepareOperation(access.business.id, user.id, key, input);
    return { preview: (plan ?? operation)!.preview, token: encryptSecret(JSON.stringify({ purpose: "manual-operation-v1", userId: user.id, businessId: access.business.id, expires: Date.now() + 600000, operation, plan })) };
  } catch (error) { return { error: (error as Error).message }; }
}
export async function confirmManualOperation(slug: string, token: string) {
  try {
    const user = await getSessionUser(); const access = user ? await requireBusinessAccess(user.id, slug) : null;
    const ticket = JSON.parse(decryptSecret(token)) as { purpose: string; userId: string; businessId: string; expires: number; operation: PreparedOperation; plan?: PreparedPlan };
    if (!user || !access || ticket.purpose !== "manual-operation-v1" || ticket.userId !== user.id || ticket.businessId !== access.business.id || !Number.isFinite(ticket.expires) || ticket.expires <= Date.now()) throw Error("Konfirmimi skadoi ose nuk është i vlefshëm.");
    const result = ticket.plan ? await executeOperationPlan(access.business.id, user.id, ticket.plan) : await executeOperation(access.business.id, user.id, ticket.operation);
    revalidatePath(`/b/${access.business.slug}`, "layout");
    return { success: result.message };
  } catch (error) { return { error: (error as Error).message }; }
}
