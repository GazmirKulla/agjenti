import { NextResponse } from "next/server";
import { withAiUsage } from "@/lib/ai/usage";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { isModuleEnabled } from "@/lib/dashboard/modules/permissions";
import { loadItemSetup } from "@/lib/items/business";
import { fieldTemplateFor } from "@/lib/items/field-templates";
import { supportedBusinessCategories } from "@/lib/onboarding/categories";
import { proposeProductSkeleton } from "@/lib/onboarding/product-skeleton";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

/**
 * Onboarding: the products' structure to confirm before entering the dashboard. The business's current
 * fields (the category's starters are set at the end of the questions), the fields and stock mode the scan
 * found with their quotes, and the stock rules. Read only; saving goes through the fields and stock actions.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Hyr përsëri." }, { status: 401 });
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const access = slug ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) return NextResponse.json({ error: "Nuk ke qasje në këtë biznes." }, { status: 403 });
  const businessId = access.business.id;
  const [profile, items] = await Promise.all([loadDashboardProfile(businessId), loadItemSetup(businessId)]);
  if (!isModuleEnabled(profile, "products") || !items.fieldsRead) return NextResponse.json({ enabled: false });
  const reserved = items.kind.fields.map(f => f.key);
  const proposal = await withAiUsage(businessId, () => proposeProductSkeleton(businessId, items.fields, reserved));
  return NextResponse.json({
    enabled: true,
    names: items.names,
    fields: items.fields,
    fixed: { name: items.kind.plural, fields: items.kind.fields.map(f => ({ key: f.key, label: f.label })) },
    suggested: { category: supportedBusinessCategories.find(([id]) => id === items.category)?.[1] ?? null, fields: fieldTemplateFor(items.category) },
    discovered: proposal.fields,
    stock: items.stockRead ? { ...items.stock, ...(proposal.stock && items.stock.defaultMode === "off" ? { defaultMode: proposal.stock.mode } : {}) } : null,
    stockEvidence: proposal.stock?.evidence ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
