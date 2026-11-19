"use server";
import { redirect } from "next/navigation";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadBillingUsage } from "./service";
import { BillingError, isPaidPlan, startHostedPayment } from "./payments";
import { pokConfigured } from "./pok";

/** "Paguaj me POK": the person who pays the plan goes to POK's own payment page for one month of it. */
export async function payWithPok(slug: string, plan: string) {
  const user = await getSessionUser();
  const access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access) return { error: "Nuk ke qasje në këtë biznes." };
  if (!isPaidPlan(plan)) return { error: "Zgjidh një paketë me pagesë." };
  if (!pokConfigured()) return { error: "Pagesat me POK nuk janë aktive ende." };
  const usage = await loadBillingUsage(access.business.id);
  if (usage.scope !== "account" || usage.billingUserId !== user.id) return { error: "Paketën e paguan pronari që e menaxhon." };
  let url: string;
  try { url = (await startHostedPayment(user.id, plan, `/b/${access.business.slug}/settings/billing?tab=billing`, user.email)).url; }
  catch (error) { return { error: error instanceof BillingError ? error.message : "Pagesa nuk u nis. Provo përsëri." }; }
  redirect(url);
}
