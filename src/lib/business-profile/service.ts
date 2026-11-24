import { createServiceSupabase } from "@/lib/supabase/service";
import { readProfile, type BusinessProfile } from "./model";

export type ProfileSuggestion = { field: "website" | "instagram"; value: string; source: string };
/**
 * The profile with its stamp, and what the sources show that the profile does not say yet: offered as a visible
 * suggestion the owner accepts with Ruaj, never copied on its own.
 */
export async function loadBusinessProfile(businessId: string): Promise<{ profile: BusinessProfile; updatedAt: string; timezone: string | null; suggestions: ProfileSuggestion[] }> {
  const db = createServiceSupabase();
  const [business, preview] = await Promise.all([
    db.from("businesses").select("public_profile,public_profile_updated_at,timezone,instagram_username").eq("id", businessId).single(),
    db.from("business_source_previews").select("website").eq("business_id", businessId).maybeSingle(),
  ]);
  if (business.error || !business.data) throw new Error("Profili i biznesit nuk u lexua.");
  const profile = readProfile(business.data.public_profile);
  const suggestions: ProfileSuggestion[] = [];
  const website = (preview.data?.website as { url?: string; confirmed?: boolean } | null) ?? null;
  if (!profile.contacts?.website && website?.confirmed && website.url) suggestions.push({ field: "website", value: website.url, source: "Website-i i konfirmuar te Burimet" });
  const instagram = business.data.instagram_username as string | null;
  if (instagram && !profile.contacts?.socials?.some(item => item.network === "instagram"))
    suggestions.push({ field: "instagram", value: `https://instagram.com/${instagram.replace(/^@/, "")}`, source: "Instagram-i i lidhur te Burimet" });
  return { profile, updatedAt: business.data.public_profile_updated_at, timezone: business.data.timezone ?? null, suggestions };
}
