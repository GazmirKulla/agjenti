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
/** The Agent's spaces, as on the web: knowledge (sources live inside it), behavior and actions, test and check, then advanced processes. */
const agentSpaces: Record<string, { label: string; description: string }> = {
  knowledge: { label: "Oferta", description: "Çfarë ofron biznesi dhe informacioni që përdor Agjenti" },
  agents: { label: "Komunikimi", description: "Si flet Agjenti me klientët" },
  workflows: { label: "Proceset e avancuara", description: "Workflow-t e publikuara të biznesit" },
};
function mobileNavigation(slug: string, enabled: string[], t: (text: string) => string) {
  const base = `/b/${encodeURIComponent(slug)}`;
  const topic = (id: string, label: string, description: string, path: string) => ({ id, label: t(label), description: t(description), path: `${base}/${path}`, group: "agent" as const });
  const items = navigationOrder.filter((id) => enabled.includes(id) && id !== "sources").flatMap((id) => {
    const space = agentSpaces[id];
    const item = { id, label: t(space?.label ?? moduleRegistry[id].label), description: t(space?.description ?? moduleRegistry[id].description),
      path: `${base}${moduleRegistry[id].path ? `/${moduleRegistry[id].path}` : ""}`, ...(space ? { group: "agent" as const } : {}) };
    return id === "agents" ? [topic("agent-business", "Biznesi", "Kontaktet, adresa dhe orari që u jep Agjenti klientëve", "agents/business"),
      ...(enabled.includes("orders") ? [topic("agent-orders", "Porositë", "Si merr Agjenti porosi dhe kur ia kalon stafit", "agents/orders")] : []),
      ...(enabled.includes("bookings") || enabled.includes("services") ? [topic("agent-bookings", "Rezervimet", "Nëse Agjenti rezervon vetë dhe për cilat shërbime", "agents/bookings")] : []),
      item, topic("agent-test", "Prova dhe kontrolli", "Provo një përgjigje dhe shiko çfarë informacioni u lexua", "agents/test")] : [item];
  });
  // The agent spaces keep their own order, whatever the module order is.
  const order = ["agent-business", "knowledge", "agent-orders", "agent-bookings", "agents", "agent-test", "workflows"];
  const agent = items.filter((item) => "group" in item).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return [{ id: "campaigns", label: t("Fushatat"), description: t("Oferta për kontaktet që kanë pranuar marketingun"), path: `${base}/campaigns` },
    ...items.filter((item) => !("group" in item)), ...agent];
}
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
          navigation: mobileNavigation(business.slug, profile.navigationItems, t),
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
