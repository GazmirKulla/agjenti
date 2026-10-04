"use server";

import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { importProductFromUrl } from "./import-url";

export async function previewProductFromUrl(slug: string, form: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const result = await importProductFromUrl(String(form.get("source_url") ?? ""));
  if ("error" in result) return { error: result.error };
  return { product: result.product, success: result.note };
}
