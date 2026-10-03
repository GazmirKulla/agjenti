import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = await isPlatformAdmin(user.id);
  const service = createServiceSupabase();
  if (!admin) {
    const { data } = await service
      .from("business_users")
      .select("user_id")
      .eq("business_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: business } = await service
    .from("businesses")
    .select("slug")
    .eq("id", id)
    .maybeSingle();

  await service
    .from("instagram_connections")
    .update({ status: "disconnected", updated_at: new Date().toISOString() })
    .eq("business_id", id)
    .neq("status", "disconnected");

  const fallback = new URL("/admin/conversations", request.url);
  const destination = business?.slug
    ? new URL(`/b/${business.slug}/instagram?disconnected=1`, request.url)
    : fallback;
  return NextResponse.redirect(destination, 303);
}
