import { createServiceSupabase } from "@/lib/supabase/service";

export type DeleteBusinessResult =
  | { ok: true; slug: string; name: string }
  | { ok: false; error: string; status: number };

/**
 * Hard-deletes a business and cascaded tenant data.
 * Clears onboarding rows first so former owners can create a new workspace.
 */
export async function deleteBusinessCompletely(
  businessId: string,
): Promise<DeleteBusinessResult> {
  const db = createServiceSupabase();
  const { data: business, error: loadError } = await db
    .from("businesses")
    .select("id,slug,name")
    .eq("id", businessId)
    .maybeSingle();
  if (loadError)
    return {
      ok: false,
      error: "Biznesi nuk u ngarkua. Provo përsëri.",
      status: 500,
    };
  if (!business)
    return { ok: false, error: "Biznesi nuk u gjet.", status: 404 };

  const { error: onboardingError } = await db
    .from("business_onboarding")
    .delete()
    .eq("business_id", businessId);
  if (onboardingError)
    return {
      ok: false,
      error: "Nuk u pastrua onboarding-u i biznesit. Provo përsëri.",
      status: 500,
    };

  const { data: deleted, error: deleteError } = await db
    .from("businesses")
    .delete()
    .eq("id", businessId)
    .select("id,slug,name")
    .maybeSingle();
  if (deleteError)
    return {
      ok: false,
      error: "Biznesi nuk u fshi. Provo përsëri.",
      status: 500,
    };
  if (!deleted)
    return { ok: false, error: "Biznesi nuk u gjet.", status: 404 };

  return { ok: true, slug: deleted.slug, name: deleted.name };
}
