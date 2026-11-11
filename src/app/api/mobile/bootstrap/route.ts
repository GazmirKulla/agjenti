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
import { publicBusinessCategories } from "@/lib/onboarding/starter";
import { loadReadiness, readinessSummary } from "@/lib/setup/readiness";
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
        const [profile, aiUsage, billing, readiness] = await Promise.all([
          loadNavigationProfile(business.id),
          // Tokens are a platform cost statistic: only platform administrators see them.
          membership.admin ? loadAiUsage(user.id, business.id, true) : null,
          loadBillingUsage(business.id).catch(() => null),
          loadReadiness(business),
        ]);
        return {
          ...business,
          aiUsage: aiUsage && aiUsageSummary(aiUsage),
          messagesAvailable: billing?.available,
          messagesUsed: billing ? billing.used + billing.reserved : undefined,
          messagesLimit: billing?.limit,
          sharedPlan: billing?.scope === "account",
          planName: billing ? plans[billing.plan]?.name : undefined,
          // "Gati për klientët": what is left before the agent answers customers.
          readiness: readinessSummary(readiness),
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
        businessCategories: publicBusinessCategories(t),
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
