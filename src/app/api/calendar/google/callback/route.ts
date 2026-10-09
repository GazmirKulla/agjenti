import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { loadDashboardProfile } from "@/lib/dashboard/profile/service";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import {
  exchangeGoogleCode,
  googleConnection,
  writableCalendars,
} from "@/lib/calendar/google";
export async function GET(request: NextRequest) {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    request.nextUrl.origin;
  const finish = (path: string) => {
    const response = NextResponse.redirect(`${origin}${path}`);
    response.cookies.set("agjenti_calendar_oauth", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/calendar/google/callback",
      maxAge: 0,
    });
    return response;
  };
  let slug = "";
  try {
    const payload = JSON.parse(
      decryptSecret(request.cookies.get("agjenti_calendar_oauth")?.value ?? ""),
    );
    const user = await getSessionUser();
    if (
      !user ||
      payload.userId !== user.id ||
      payload.exp < Date.now() ||
      typeof payload.exp !== "number" ||
      payload.state !== request.nextUrl.searchParams.get("state") ||
      typeof payload.slug !== "string"
    )
      return finish("/account");
    const access = await requireBusinessAccess(user.id, payload.slug);
    if (!access || access.business.id !== payload.businessId)
      return finish("/account");
    slug = access.business.slug;
    const profile = await loadDashboardProfile(access.business.id);
    if (!profile.enabledModules.includes("calendar"))
      return finish(`/b/${encodeURIComponent(slug)}`);
    const code = request.nextUrl.searchParams.get("code");
    if (request.nextUrl.searchParams.get("error") || !code)
      return finish(`/b/${encodeURIComponent(slug)}/calendar?google=cancelled`);
    const tokens = await exchangeGoogleCode(code);
    const old = await googleConnection(access.business.id);
    const values = {
      business_id: access.business.id,
      access_token_encrypted: encryptSecret(tokens.access_token),
      refresh_token_encrypted: encryptSecret(tokens.refresh_token!),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      connected: true,
      updated_at: new Date().toISOString(),
    };
    if (old?.calendar_id) {
      const calendars = await writableCalendars({ ...old, ...values });
      if (!calendars.some((c) => c.id === old.calendar_id))
        throw new Error("wrong_account");
    }
    await createServiceSupabase()
      .from("google_calendar_connections")
      .upsert(values, { onConflict: "business_id" })
      .throwOnError();
    return finish(`/b/${encodeURIComponent(slug)}/calendar?google=connected`);
  } catch {
    return finish(
      slug
        ? `/b/${encodeURIComponent(slug)}/calendar?google=error`
        : "/account",
    );
  }
}
