import { NextResponse } from "next/server";
import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { homeForAccess } from "@/lib/auth/destination";
export async function GET(request: Request) {
  const user = await getSessionUser();
  const destination = user
    ? homeForAccess(await listMemberships(user.id))
    : "/login";
  return NextResponse.redirect(new URL(destination, request.url));
}
