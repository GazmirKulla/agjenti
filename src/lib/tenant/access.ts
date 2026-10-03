import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";

export type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  catalog_source: "internal" | "external";
  auto_reply: boolean;
};

export const getSessionUser = cache(async function getSessionUser() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const isPlatformAdmin = cache(async function isPlatformAdmin(
  userId: string,
): Promise<boolean> {
  const supabase = createServiceSupabase();
  const { data } = await supabase
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data?.user_id);
});

export const listMemberships = cache(async function listMemberships(
  userId: string,
) {
  const supabase = createServiceSupabase();
  const admin = await isPlatformAdmin(userId);
  if (admin) {
    const { data } = await supabase
      .from("businesses")
      .select("id,name,slug,catalog_source,auto_reply")
      .order("name");
    return { admin: true, businesses: (data ?? []) as BusinessRow[] };
  }

  // Query në dy hapa — më i besueshëm se embed nested.
  const { data: links, error: linkErr } = await supabase
    .from("business_users")
    .select("business_id, role")
    .eq("user_id", userId);
  if (linkErr) {
    console.error("[listMemberships] business_users", linkErr.message);
    return { admin: false, businesses: [] as BusinessRow[] };
  }

  const ids = (links ?? []).map((row) => row.business_id).filter(Boolean);
  if (ids.length === 0) {
    return { admin: false, businesses: [] as BusinessRow[] };
  }

  const { data: businesses, error: bizErr } = await supabase
    .from("businesses")
    .select("id,name,slug,catalog_source,auto_reply")
    .in("id", ids)
    .order("name");
  if (bizErr) {
    console.error("[listMemberships] businesses", bizErr.message);
    return { admin: false, businesses: [] as BusinessRow[] };
  }

  return { admin: false, businesses: (businesses ?? []) as BusinessRow[] };
});

export const requireBusinessAccess = cache(async function requireBusinessAccess(
  userId: string,
  slug: string,
) {
  const { admin, businesses } = await listMemberships(userId);
  const business = businesses.find((item) => item.slug === slug);
  if (!business) return null;
  return { admin, business };
});
