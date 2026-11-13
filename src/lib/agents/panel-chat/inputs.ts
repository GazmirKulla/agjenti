import { createServiceSupabase } from "@/lib/supabase/service";
import { normalizeInstagramUsername } from "@/lib/instagram/public-profile";

/** Customer details an admin gives a Real chat (ChatLab "Inputs"). */
export type PanelInputs = { senderInstagram?: string | null; customerName?: string | null };

/** Validates the inputs a Real chat message may carry. Unknown or invalid values are refused. */
export function readPanelInputs(input: Record<string, unknown>): PanelInputs | { error: string } {
  const result: PanelInputs = {};
  if (input.senderInstagram !== undefined) {
    if (typeof input.senderInstagram !== "string" || input.senderInstagram.length > 60) return { error: "Instagram-i i klientit nuk është i vlefshëm." };
    if (input.senderInstagram.trim()) {
      const username = normalizeInstagramUsername(input.senderInstagram);
      if (!username) return { error: "Instagram-i i klientit nuk është i vlefshëm." };
      result.senderInstagram = username;
    }
  }
  if (input.customerName !== undefined) {
    if (typeof input.customerName !== "string" || input.customerName.trim().length > 80) return { error: "Emri i klientit është shumë i gjatë." };
    if (input.customerName.trim()) result.customerName = input.customerName.trim();
  }
  return result;
}

/** Gives the Real chat's customer the name and Instagram account from Inputs, so
 * the chat, its customer, leads and orders carry them like an Instagram DM. */
export async function applyPanelInputs(scope: { businessId: string; userId: string; streamId: string }, inputs: PanelInputs, db = createServiceSupabase()) {
  if (!inputs.senderInstagram && !inputs.customerName) return true;
  const conversation = await db.from("conversations").select("id,customer_id").eq("business_id", scope.businessId)
    .eq("panel_user_id", scope.userId).eq("panel_stream_id", scope.streamId).eq("channel", "panel").maybeSingle();
  if (conversation.error || !conversation.data) return false;
  const conversationPatch: Record<string, string> = {};
  const customerPatch: Record<string, string> = {};
  if (inputs.senderInstagram) { conversationPatch.participant_username = inputs.senderInstagram; customerPatch.username = inputs.senderInstagram; }
  const name = inputs.customerName ?? (inputs.senderInstagram ? `@${inputs.senderInstagram}` : null);
  if (name) { conversationPatch.participant_display_name = name; customerPatch.display_name = name; }
  const [saved, customer] = await Promise.all([
    db.from("conversations").update(conversationPatch).eq("id", conversation.data.id),
    conversation.data.customer_id ? db.from("customers").update(customerPatch).eq("id", conversation.data.customer_id).eq("business_id", scope.businessId) : Promise.resolve({ error: null }),
  ]);
  return !saved.error && !customer.error;
}
