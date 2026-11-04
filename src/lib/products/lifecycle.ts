import { createServiceSupabase } from "@/lib/supabase/service";
import { uuid } from "@/lib/calendar/model";

export async function changeProductLifecycle(input: {
  businessId: string; userId: string; id: string; expected: string; operation: "delete" | "archive" | "restore";
}) {
  if (!uuid(input.id) || !Number.isFinite(Date.parse(input.expected))) throw Error("Rifresko produktin para ndryshimit.");
  const result = await createServiceSupabase().rpc("product_lifecycle", {
    p_business: input.businessId, p_user: input.userId, p_product: input.id,
    p_expected: input.expected, p_operation: input.operation,
  });
  if (result.error || !result.data) {
    const messages: Record<string, string> = {
      product_has_history: "Produkti lidhet me porosi, biseda ose workflow. Arkivoje për të ruajtur historikun.",
      stale_product: "Produkti ndryshoi ose u hoq. Rishqyrto ndryshimin.",
      unauthorized: "Nuk ke më qasje në këtë biznes.",
      external_catalog: "Ky produkt menaxhohet nga katalogu i jashtëm.",
    };
    throw Error(messages[result.error?.message ?? ""] ?? "Ndryshimi i produktit nuk u konfirmua.");
  }
  return { message: input.operation === "delete" ? "Produkti u fshi." : input.operation === "archive" ? "Produkti u arkivua." : "Produkti u rikthye si draft joaktiv.", path: "products" };
}
