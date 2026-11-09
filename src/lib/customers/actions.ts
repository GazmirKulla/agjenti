"use server";
import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

import type { CustomerAction } from "./types";
const actions: CustomerAction[] = ["archive", "restore", "delete"];

/** Owner or platform administrator: remove a customer from the list (restorable),
 * bring them back, or delete them for good (contact and orders; conversations stay). */
export async function manageCustomer(slug: string, customerId: string, action: CustomerAction) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  if (!actions.includes(action) || !/^[0-9a-f-]{36}$/i.test(customerId)) return { error: "Kërkesë e pavlefshme." };
  const { data, error } = await createServiceSupabase().rpc("manage_customer", {
    p_business: access.business.id, p_user: user.id, p_customer: customerId, p_action: action,
  });
  if (error) {
    if (error.message.includes("customer_forbidden")) return { error: "Vetëm pronari i biznesit mund të heqë ose fshijë klientë." };
    if (error.message.includes("customer_not_found")) return { error: "Klienti nuk u gjet. Rifresko faqen." };
    return { error: "Veprimi nuk u krye. Provo përsëri." };
  }
  revalidatePath(`/b/${access.business.slug}/customers`);
  const result = (data ?? {}) as { orders?: number; conversations_kept?: number };
  return {
    success: action === "archive" ? "Klienti u hoq nga lista. E gjen te “Të arkivuar”."
      : action === "restore" ? "Klienti u rikthye në listë."
      : `Klienti u fshi përgjithmonë${result.orders ? ` bashkë me ${result.orders} porosi` : ""}. Bisedat mbeten në Inbox.`,
  };
}
