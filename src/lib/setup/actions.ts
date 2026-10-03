"use server";
import { revalidatePath } from "next/cache";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { loadSetupStatus } from "./status";
import { isReady } from "./model";
export async function launchBusiness(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Hyr në llogari për të vazhduar." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  const mode = form.get("mode");
  if (mode !== "automatic" && mode !== "manual")
    return { error: "Zgjidh mënyrën e përdorimit." };
  const status = await loadSetupStatus(access.business.id);
  if (!isReady(status))
    return {
      error: "Përfundo pesë hapat dhe lidh Instagram-in përpara se të fillosh.",
    };
  const { error } = await createServiceSupabase().rpc("launch_business", {
    p_business_id: access.business.id,
    p_automatic: mode === "automatic",
  });
  if (error)
    return {
      error:
        "Konfigurimi ndryshoi ose nuk u ruajt. Rifresko dhe kontrollo hapat.",
    };
  revalidatePath(`/b/${slug}`, "layout");
  return {
    success:
      mode === "automatic"
        ? "Përgjigjet automatike u aktivizuan."
        : "Hapësira është gati. Përgjigjet mbeten manuale.",
  };
}

export async function saveProductSetup(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Hyr në llogari për të vazhduar." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };
  const id = String(form.get("product_id") ?? "");
  const typeId = String(form.get("product_type_id") ?? "");
  const rawPrice = String(form.get("price") ?? "").trim();
  const price = Number(rawPrice);
  if (!id || !typeId || !rawPrice || !Number.isFinite(price) || price < 0)
    return { error: "Zgjidh llojin dhe vendos çmim të vlefshëm." };
  const db = createServiceSupabase();
  const type = await db
    .from("product_types")
    .select("id")
    .eq("id", typeId)
    .eq("business_id", access.business.id)
    .maybeSingle();
  if (type.error || !type.data)
    return { error: "Lloji nuk u gjet në këtë biznes." };
  const { data, error } = await db
    .from("products")
    .update({ product_type_id: typeId, price_amount: price })
    .eq("id", id)
    .eq("business_id", access.business.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { error: "Produkti nuk u përditësua." };
  revalidatePath(`/b/${slug}`, "layout");
  return { success: "Produkti u lidh me procesin e porosisë." };
}
