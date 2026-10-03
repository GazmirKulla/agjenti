import { NextResponse } from "next/server";
import { probeLinkedCatalog } from "@/lib/integrations/zana";
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
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isPlatformAdmin(user.id))) {
    const { data } = await createServiceSupabase()
      .from("business_users")
      .select("user_id")
      .eq("business_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!data)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    catalog_url?: string;
    orders_url?: string;
    api_secret?: string;
  } | null;

  const result = await probeLinkedCatalog({
    businessId: id,
    catalogUrl: body?.catalog_url,
    ordersUrl: body?.orders_url,
    apiSecret: body?.api_secret,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
