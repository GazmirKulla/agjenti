import { NextResponse } from "next/server";
import { deleteBusinessCompletely } from "@/lib/businesses/delete-business";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

async function canDeleteBusiness(userId: string, businessId: string) {
  if (await isPlatformAdmin(userId)) return true;
  const service = createServiceSupabase();
  const { data } = await service
    .from("business_users")
    .select("user_id")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();
  return Boolean(data);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: businessId } = await context.params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await canDeleteBusiness(user.id, businessId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let confirmSlug = "";
  try {
    const body = (await request.json()) as { confirmSlug?: string };
    confirmSlug = String(body.confirmSlug ?? "")
      .trim()
      .toLowerCase();
  } catch {
    return NextResponse.json(
      { error: "Kërkesa nuk është e vlefshme." },
      { status: 400 },
    );
  }

  const service = createServiceSupabase();
  const { data: business } = await service
    .from("businesses")
    .select("slug")
    .eq("id", businessId)
    .maybeSingle();
  if (!business)
    return NextResponse.json({ error: "Biznesi nuk u gjet." }, { status: 404 });
  if (!confirmSlug || confirmSlug !== business.slug) {
    return NextResponse.json(
      {
        error: `Shkruaj saktë adresën e biznesit (${business.slug}) për të konfirmuar fshirjen.`,
      },
      { status: 400 },
    );
  }

  const result = await deleteBusinessCompletely(businessId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, slug: result.slug });
}
