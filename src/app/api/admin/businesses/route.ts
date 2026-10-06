import { NextResponse } from "next/server";
import {
  allocateUniqueBusinessSlug,
  slugifyBusinessName,
} from "@/lib/businesses/slug";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await isPlatformAdmin(user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json()) as {
    name?: string;
    auto_reply?: boolean;
  };
  const name = body.name?.trim();
  const base = name ? slugifyBusinessName(name) : null;
  if (!name || !base) {
    return NextResponse.json(
      { error: "Emri i biznesit është i detyrueshëm." },
      { status: 400 },
    );
  }
  const service = createServiceSupabase();
  const slug = await allocateUniqueBusinessSlug(service, base);
  const { data, error } = await service
    .from("businesses")
    .insert({
      name,
      slug,
      catalog_source: "internal",
      auto_reply: body.auto_reply === true,
    })
    .select("id,slug")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
