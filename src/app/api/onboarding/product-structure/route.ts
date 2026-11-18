import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { storeProductFields } from "@/lib/items/fields-store";
import { storeStockSettings } from "@/lib/products/stock-store";
import { withAiUsage } from "@/lib/ai/usage";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { isModuleEnabled } from "@/lib/dashboard/modules/permissions";
import { loadItemSetup } from "@/lib/items/business";
import { fieldTemplateFor } from "@/lib/items/field-templates";
import { supportedBusinessCategories } from "@/lib/onboarding/categories";
import { proposeProductSkeleton } from "@/lib/onboarding/product-skeleton";
import { requireBusinessAccess } from "@/lib/tenant/access";

/**
 * Onboarding: the products' structure to confirm before entering the dashboard. The business's current
 * fields (the category's starters are set at the end of the questions), the fields and stock mode the scan
 * found with their quotes, and the stock rules. The web saves through the fields and stock actions; the app
 * (bearer) saves with POST, through the same stores.
 */
export async function GET(request: Request) {
  const user = await getRequestUser(request);
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

/**
 * The app's onboarding saves the structure the owner confirmed: `{ fields?, stock? }` with the whole field list
 * and the stock rules. Owner only, validated by the same stores as Produktet → Struktura.
 */
export async function POST(request: Request) {
  if (!permittedWrite(request)) return NextResponse.json({ error: "Kërkesë e palejuar." }, { status: 403 });
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Hyr përsëri." }, { status: 401 });
  const slug = new URL(request.url).searchParams.get("slug") ?? "";
  const access = slug ? await requireBusinessAccess(user.id, slug) : null;
  if (!access) return NextResponse.json({ error: "Nuk ke qasje në këtë biznes." }, { status: 403 });
  const body = await request.json().catch(() => null) as { fields?: unknown; stock?: unknown } | null;
  const stock = body?.stock && typeof body.stock === "object" && !Array.isArray(body.stock) ? body.stock as Record<string, unknown> : null;
  if (!body || (body.fields === undefined && !stock)) return NextResponse.json({ error: "Nuk ka asgjë për të ruajtur." }, { status: 400 });
  // Fields first: when they fail, the stock rules are not saved either, so the owner retries one whole step.
  const fields = body.fields === undefined ? null : await storeProductFields(access.business.id, user.id, body.fields);
  if (fields && "error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });
  const settings = stock ? await storeStockSettings(access.business.id, user.id, stock) : null;
  if (settings && "error" in settings) return NextResponse.json({ error: settings.error, ...(fields ? { fields: fields.fields } : {}) }, { status: 400 });
  revalidatePath(`/b/${access.business.slug}`, "layout");
  return NextResponse.json({ ok: true, ...(fields ? { fields: fields.fields } : {}), ...(settings ? { stock: settings.settings } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
