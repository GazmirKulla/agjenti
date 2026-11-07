import { getRequestUser } from "@/lib/auth/request";
import { listMemberships } from "@/lib/tenant/access";
import { loadNavigationProfile } from "@/lib/dashboard/profile/service";
import {
  moduleRegistry,
  navigationOrder,
} from "@/lib/dashboard/modules/registry";
import { dashboardLanguage, translator } from "@/lib/dashboard/language/core";
import { aiUsageSummary, loadAiUsage } from "@/lib/ai/usage-report";
import { loadBillingUsage, plans } from "@/lib/billing/service";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "X-Agjenti-Language" };
  const t = translator(dashboardLanguage(request.headers.get("x-agjenti-language")));
  try {
    const user = await getRequestUser(request);
    if (!user)
      return Response.json(
        { error: "Hyr përsëri në llogari." },
        { status: 401, headers },
      );
    const membership = await listMemberships(user.id);
    const businesses = await Promise.all(
      membership.businesses.map(async (business) => {
        const [profile, aiUsage, billing] = await Promise.all([
          loadNavigationProfile(business.id),
          loadAiUsage(user.id, business.id, membership.admin),
          loadBillingUsage(business.id).catch(() => null),
        ]);
        return {
          ...business,
          aiUsage: aiUsage && aiUsageSummary(aiUsage),
          messagesAvailable: billing?.available,
          planName: billing ? plans[billing.plan]?.name : undefined,
          modules: profile.enabledModules,
          navigation: navigationOrder
            .filter((id) => profile.navigationItems.includes(id))
            .map((id) => ({
              id,
              label: t(moduleRegistry[id].label),
              description: t(moduleRegistry[id].description),
              path: `/b/${encodeURIComponent(business.slug)}${moduleRegistry[id].path ? `/${moduleRegistry[id].path}` : ""}`,
            })),
        };
      }),
    );
    return Response.json(
      {
        user: { id: user.id, email: user.email, canDeleteAccount: !membership.admin },
        businesses,
      },
      { headers },
    );
  } catch {
    return Response.json(
      { error: "Bizneset nuk u ngarkuan. Provo përsëri." },
      { status: 503, headers },
    );
  }
}
