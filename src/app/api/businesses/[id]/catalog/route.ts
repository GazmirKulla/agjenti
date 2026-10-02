import { NextResponse } from "next/server";
import { fetchLinkedCatalog } from "@/lib/integrations/zana";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

export async function GET(
  _request: Request,
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
  try {
    const products = await fetchLinkedCatalog(id);
    return NextResponse.json({ products });
  } catch {
    return NextResponse.json(
      {
        error:
          "Katalogu i jashtëm nuk u ngarkua. Kontrollo konfigurimin e integrimit.",
      },
      { status: 502 },
    );
  }
}
