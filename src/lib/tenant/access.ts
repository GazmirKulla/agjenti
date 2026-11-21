import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { attributeAiUsage } from "@/lib/ai/usage";
import { loadBusinessLogos } from "@/lib/businesses/logo";

export type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  catalog_source: "internal" | "external";
  auto_reply: boolean;
  /** From business-logos; null shows the initials. */
  logo_url?: string | null;
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

/** Adds each business's logo; before the logo migration the rows stay as they are. */
async function withLogos(db: ReturnType<typeof createServiceSupabase>, rows: BusinessRow[]): Promise<BusinessRow[]> {
  const logos = await loadBusinessLogos(db, rows.map(row => row.id));
  return rows.map(row => ({ ...row, logo_url: logos.get(row.id) ?? null }));
}

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
    return { admin: true, businesses: await withLogos(supabase, (data ?? []) as BusinessRow[]) };
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

  return { admin: false, businesses: await withLogos(supabase, (businesses ?? []) as BusinessRow[]) };
});

export async function requireBusinessAccess(userId: string, slug: string) {
  const access = await resolveBusinessAccess(userId, slug);
  // Runs on every call: cached results must still name the business for each metering scope.
  if (access) attributeAiUsage(access.business.id);
  return access;
}

const resolveBusinessAccess = cache(async function resolveBusinessAccess(
  userId: string,
  slug: string,
) {
  const { admin, businesses } = await listMemberships(userId);
  let business = businesses.find((item) => item.slug === slug);
  // Legacy addresses remain usable after replacing UUID slugs. Only resolve
  // aliases inside businesses this user can already access.
  if (!business && businesses.length) {
    const db = createServiceSupabase();
    const { data: alias } = await db
      .from("business_slug_aliases")
      .select("business_id")
      .eq("slug", slug)
      .in("business_id", businesses.map((item) => item.id))
      .maybeSingle();
    business = businesses.find((item) => item.id === alias?.business_id);
  }
  if (!business) return null;
  return { admin, business };
});
