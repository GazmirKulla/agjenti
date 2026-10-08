import { fetchPublicPage } from "@/lib/products/import-url";
import { extractProductFromHtml } from "@/lib/products/page-extract";
import { fetchInstagramMedia } from "@/lib/instagram/media";
import { decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { fetchInstagramBusinessProfile } from "@/lib/instagram/business-profile";
import { selectDiscoveryImages } from "@/lib/discovery/images";

export async function extractWebsite(url: string, purpose: "catalog" | "onboarding" = "catalog") {
  const first = await fetchPublicPage(url);
  if ("error" in first) throw new Error(first.error);
  const base = new URL(first.url);
  const links = [
    ...first.body.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi),
  ].flatMap((m) => {
    try {
      const u = new URL(m[1], base);
      u.hash = "";
      return u.origin === base.origin &&
        /product|shop|service|faq|about|shipping|return|policy|contact|produkt|transport|rreth|porosi|payment|delivery|download|shkarko|how-it-works|si-funksionon|booking|rezerv|terms/i.test(
          u.pathname,
        )
        ? [u.href]
        : [];
    } catch {
      return [];
    }
  });
  const candidates = [...new Set(links)].filter((u) => u !== base.href);
  if (purpose === "onboarding") {
    // Spend the bounded crawl on how the business operates before item pages.
    const priority = (url: string) => /faq|how-it-works|si-funksionon|terms|payment|delivery|download|shkarko|porosi|booking|rezerv|shipping|return|policy|transport/i.test(new URL(url).pathname) ? 0 : /about|contact|rreth/i.test(new URL(url).pathname) ? 1 : 2;
    candidates.sort((a, b) => priority(a) - priority(b));
  }
  const selected = candidates.slice(0, 7);
  const pages = [first];
  let skipped = 0;
  for (let i = 0; i < selected.length; i += 3) {
    const batch = await Promise.allSettled(
      selected.slice(i, i + 3).map((u) => fetchPublicPage(u)),
    );
    for (const result of batch)
      if (result.status === "fulfilled" && !("error" in result.value))
        pages.push(result.value);
      else skipped++;
  }
  const captured = pages
    .map((page, index) => {
      const product = purpose === "catalog" ? extractProductFromHtml(page.body, page.url) : null;
      const plain = page.body
        .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 11000);
      const title = page.body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { text: `URL: ${page.url}\n${plain}\n${product ? JSON.stringify(product) : ""}`, preview: { id: `page-${index}`, title: (title || product?.name || `${new URL(page.url).hostname}${new URL(page.url).pathname}`).slice(0, 120), excerpt: plain.slice(0, 180), imageUrl: null } };
    });
  const text = captured.map(page => page.text).join("\n\n").slice(0, 65000);
  return {
    text,
    reference: base.href,
    previews: captured.map(page => page.preview),
    pageCount: pages.length,
    note: `U lexuan ${pages.length} faqe publike (maksimumi 8 për skanim). ${skipped ? `${skipped} faqe nuk u lexuan.` : ""} Informacioni përfshin faqet e përzgjedhura të biznesit.`,
  };
}
export async function extractInstagram(businessId: string) {
  const { data, error } = await createServiceSupabase()
    .from("instagram_connections")
    .select("id,ig_user_id,access_token_ciphertext,status,expires_at,username")
    .eq("business_id", businessId)
    .neq("status", "disconnected")
    .maybeSingle();
  if (
    error ||
    !data ||
    data.status !== "connected" ||
    (data.expires_at && Date.parse(data.expires_at) < Date.now())
  )
    throw new Error("Lidh ose rilidh Instagram-in për ta analizuar.");
  const token = decryptSecret(data.access_token_ciphertext);
  const [result, profile] = await Promise.all([
    fetchInstagramMedia(token),
    fetchInstagramBusinessProfile(token, data.ig_user_id),
  ]);
  const posts = "error" in result ? [] : result.posts;
  if ("error" in result && !profile.data.biography && !profile.data.website) throw new Error(result.error);
  const text = [Object.entries(profile.data).map(([field, value]) => `${field}: ${value}`).join("\n"), ...posts
    .map((p) =>
      `Post: ${p.permalink ?? ""}\nCaption: ${p.caption ?? ""}\nImage: ${p.imageUrl ?? ""}`,
    )]
    .join("\n")
    .slice(0, 65000);
  if (!text) throw new Error("Nuk u gjet përmbajtje për analizë.");
  return {
    text,
    reference: `instagram:${data.username ?? businessId}`,
    connectionId: data.id as string,
    images: selectDiscoveryImages(posts),
    website: profile.data.website ?? null,
    profile: profile.data,
    postCount: posts.length,
    note: `U lexuan ${posts.length} postime${!("error" in result) && result.truncated ? " (lexim i pjesshëm)" : ""}. ${"error" in result ? "Postimet nuk u kthyen; përdorim informacionin e profilit. " : ""}${profile.note} Videot përfaqësohen vetëm nga thumbnail-i.`,
  };
}
