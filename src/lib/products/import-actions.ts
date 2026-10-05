"use server";

import { decryptSecret } from "@/lib/crypto/tokens";
import { fetchPublicInstagramMedia, parseInstagramUsername, productsFromPosts } from "@/lib/instagram/media";
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

export async function scanInstagramProducts(slug: string, account: string) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const handle = parseInstagramUsername(account);
  if (!handle) return { error: "Shkruaj një llogari publike, p.sh. @dyqani ose linkun e profilit." };

  const { data: conn, error } = await createServiceSupabase()
    .from("instagram_connections")
    .select("access_token_ciphertext, status, expires_at, ig_user_id")
    .eq("business_id", access.business.id)
    .neq("status", "disconnected")
    .maybeSingle();
  if (error) return { error: "Lidhja e Instagram nuk u lexua." };
  if (!conn || conn.status !== "connected") {
    return { error: "Lidh një llogari profesionale. Ajo përdoret vetëm që Instagram ta lejojë kërkimin e llogarisë publike." };
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

  const media = await fetchPublicInstagramMedia(token, String(conn.ig_user_id ?? ""), handle);
  if ("error" in media) return media;
  if (!media.posts.length) return { error: `Nuk u gjetën postime te @${handle}.` };

  const products = productsFromPosts(media.posts).slice(0, 100);
  if (!products.length) {
    return {
      error: `U lexuan ${media.posts.length} postime të @${handle}, por asnjë nuk kishte çmim në tekst (p.sh. 790 Lekë).`,
    };
  }

  const scope = media.truncated
    ? `U lexuan ${media.posts.length} postime më të reja të @${handle}`
    : `U lexuan ${media.posts.length} postime të @${handle}`;
  const found = products.length === 1 ? "1 duket si produkt me çmim" : `${products.length} duken si produkte me çmim`;
  return {
    products,
    success: `${scope}. ${found}. Kontrolloje listën, pastaj ruaji.`,
  };
}
