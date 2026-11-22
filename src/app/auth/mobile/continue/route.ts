import { NextResponse } from "next/server";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { requestOrigin } from "@/lib/http/request-origin";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/auth/mobile/continue", requestOrigin(request)));
  const access = await listMemberships(user.id);
  const destination = access.businesses.length ? `/b/${encodeURIComponent(access.businesses[0].slug)}` : access.admin ? "/admin" : "/onboarding";
  return NextResponse.redirect(new URL(destination, requestOrigin(request)));
}
