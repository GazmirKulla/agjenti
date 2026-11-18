import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";
import { defaultStockSettings, parseStockSettings, type StockSettings } from "./stock";

/** Owner or platform administrator: the business's stock rules, validated. One store for the web form and the app. */
export async function storeStockSettings(businessId: string, userId: string, raw: { deduct?: unknown; display?: unknown; defaultMode?: unknown; lowThreshold?: unknown }): Promise<{ settings: StockSettings } | { error: string }> {
  const db = createServiceSupabase();
  const { data: member } = await db.from("business_users").select("role")
    .eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (member?.role !== "owner" && !(await isPlatformAdmin(userId))) return { error: "Vetëm pronari mund ta ndryshojë këtë." };
  const parsed = parseStockSettings({ deduct: raw.deduct, display: raw.display, defaultMode: raw.defaultMode, lowThreshold: raw.lowThreshold ?? defaultStockSettings.lowThreshold });
  if ("error" in parsed) return parsed;
  const { error } = await db.from("businesses").update({ stock_settings: parsed.settings, updated_at: new Date().toISOString() }).eq("id", businessId);
  if (error) return { error: "Cilësimet e stokut nuk u ruajtën. Provo përsëri." };
  return { settings: parsed.settings };
}
