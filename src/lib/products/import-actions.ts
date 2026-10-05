"use server";

import { decryptSecret } from "@/lib/crypto/tokens";
import { fetchInstagramMedia, productsFromPosts } from "@/lib/instagram/media";
import { createServiceSupabase } from "@/lib/supabase/service";
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

export async function scanInstagramProducts(slug: string) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const { data: conn, error } = await createServiceSupabase()
    .from("instagram_connections")
    .select("access_token_ciphertext, status, expires_at")
    .eq("business_id", access.business.id)
    .neq("status", "disconnected")
    .maybeSingle();
  if (error) return { error: "Lidhja e Instagram nuk u lexua." };
  if (!conn || conn.status !== "connected") {
    return { error: "Llogaria e Instagram nuk është e lidhur." };
  }
  if (conn.expires_at) {
    const expires = Date.parse(conn.expires_at);
    if (Number.isFinite(expires) && expires < Date.now()) {
      return { error: "Lidhja e Instagram ka skaduar. Lidhe përsëri llogarinë." };
    }
  }

  let token = "";
  try {
    token = decryptSecret(conn.access_token_ciphertext);
  } catch {
    return { error: "Lidhja e Instagram nuk lexohet. Lidhe përsëri llogarinë." };
  }

  const media = await fetchInstagramMedia(token);
  if ("error" in media) return media;
  if (!media.posts.length) return { error: "Nuk u gjetën postime në këtë llogari." };

  const products = productsFromPosts(media.posts).slice(0, 100);
  if (!products.length) {
    return {
      error: `U lexuan ${media.posts.length} postime, por asnjë nuk kishte çmim në tekst (p.sh. 790 Lekë).`,
    };
  }

  const scope = media.truncated
    ? `U lexuan ${media.posts.length} postime më të reja`
    : `U lexuan ${media.posts.length} postime`;
  const found = products.length === 1 ? "1 duket si produkt me çmim" : `${products.length} duken si produkte me çmim`;
  return {
    products,
    success: `${scope}. ${found}. Kontrolloje listën, pastaj ruaji.`,
  };
}
