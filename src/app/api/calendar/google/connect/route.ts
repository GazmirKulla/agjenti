import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { encryptSecret } from "@/lib/crypto/tokens";
import { googleAuthorizeUrl } from "@/lib/calendar/google";
export async function POST(request: Request) {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    new URL(request.url).origin;
  if (request.headers.get("origin") !== origin)
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const form = await request.formData(),
    slug = String(form.get("slug") ?? "");
  const user = await getSessionUser(),
    access = user ? await requireBusinessAccess(user.id, slug) : null;
  if (!user || !access)
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const profile = await loadDashboardProfile(access.business.id);
  if (!profile.enabledModules.includes("calendar"))
    return NextResponse.json({ error: "Calendar disabled" }, { status: 403 });
  try {
    const state = randomUUID();
    const payload = {
      state,
      businessId: access.business.id,
      slug: access.business.slug,
      userId: user.id,
      exp: Date.now() + 600000,
    };
    const response = NextResponse.redirect(googleAuthorizeUrl(state), 303);
    response.cookies.set(
      "agjenti_calendar_oauth",
      encryptSecret(JSON.stringify(payload)),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/api/calendar/google/callback",
        maxAge: 600,
      },
    );
    return response;
  } catch {
    return NextResponse.redirect(
      `${origin}/b/${encodeURIComponent(access.business.slug)}/calendar?google=unavailable`,
      303,
    );
  }
}
