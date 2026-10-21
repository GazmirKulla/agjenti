import { getRequestUser } from "@/lib/auth/request";
import { listMemberships } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { moduleRegistry, navigationOrder } from "@/lib/dashboard/modules/registry";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const user = await getRequestUser(request);
    if (!user) return Response.json({ error: "Hyr përsëri në llogari." }, { status: 401, headers });
    const membership = await listMemberships(user.id);
    const businesses = await Promise.all(membership.businesses.map(async business => {
      const profile = await loadDashboardProfile(business.id);
      return { ...business, modules: profile.enabledModules,
        navigation: navigationOrder.filter(id => profile.enabledModules.includes(id)).map(id => ({
          id, label: moduleRegistry[id].label, description: moduleRegistry[id].description,
          path: `/b/${encodeURIComponent(business.slug)}${moduleRegistry[id].path ? `/${moduleRegistry[id].path}` : ""}`,
        })),
      };
    }));
    return Response.json({ user: { id: user.id, email: user.email }, businesses }, { headers });
  } catch { return Response.json({ error: "Bizneset nuk u ngarkuan. Provo përsëri." }, { status: 503, headers }); }
}
