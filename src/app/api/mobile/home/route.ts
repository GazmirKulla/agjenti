import { getRequestUser } from "@/lib/auth/request";
import { requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { dashboardLanguage, translator } from "@/lib/dashboard/language/core";
import { HOME_PERIODS, type HomeCard, type HomeModuleLink, type HomePeriod } from "@/lib/home/model";
import { loadHomeModules } from "@/lib/home/summary";

export const runtime = "nodejs";

/** Kreu for the mobile app: the same figures, highlighted modules and module
 * list as the web home page, from the same server function. Reads only. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "X-Agjenti-Language" };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "today";
  if (!(HOME_PERIODS as readonly string[]).includes(period)) return json({ error: "Periudhë e pavlefshme." }, 400);
  const user = await getRequestUser(request);
  if (!user) return json({ error: "Hyr përsëri në llogari." }, 401);
  const access = await requireBusinessAccess(user.id, url.searchParams.get("slug") ?? "");
  if (!access) return json({ error: "Nuk ke qasje në këtë biznes." }, 403);
  const t = translator(dashboardLanguage(request.headers.get("x-agjenti-language")));
  try {
    const profile = await loadDashboardProfile(access.business.id);
    const home = await loadHomeModules(access.business, profile, period as HomePeriod);
    // Interface copy is translated; counts and business data are not.
    const card = (item: HomeCard): HomeCard => ({
      ...item, label: t(item.label), caption: t(item.caption),
      empty: item.empty && { text: t(item.empty.text), actions: item.empty.actions.map((action) => ({ ...action, label: t(action.label) })) },
    });
    const link = (item: HomeModuleLink): HomeModuleLink => ({
      ...item, label: t(item.label), description: t(item.description), requires: item.requires.map(t),
    });
    return json({ businessId: access.business.id, period: home.period, messages: home.messages,
      cards: home.cards.map(card), others: home.others.map(link) });
  } catch {
    return json({ error: "Kreu nuk u ngarkua. Provo përsëri." }, 503);
  }
}
