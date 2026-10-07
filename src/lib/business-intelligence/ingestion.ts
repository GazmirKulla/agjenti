import { fetchPublicPage } from "@/lib/products/import-url";
import { extractProductFromHtml } from "@/lib/products/page-extract";
import { fetchInstagramMedia } from "@/lib/instagram/media";
import { decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { graphVersion } from "@/lib/instagram/oauth";
import { selectDiscoveryImages } from "@/lib/discovery/images";

export async function extractWebsite(url: string) {
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
        /product|shop|service|faq|about|shipping|return|policy|contact|produkt|transport|rreth/i.test(
          u.pathname,
        )
        ? [u.href]
        : [];
    } catch {
      return [];
    }
  });
  const selected = [...new Set(links)]
    .filter((u) => u !== base.href)
    .slice(0, 7);
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
  const text = pages
    .map((page) => {
      const product = extractProductFromHtml(page.body, page.url);
      const plain = page.body
        .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 11000);
      return `URL: ${page.url}\n${plain}\n${product ? JSON.stringify(product) : ""}`;
    })
    .join("\n\n")
    .slice(0, 65000);
  return {
    text,
    reference: base.href,
    note: `U lexuan ${pages.length} faqe publike (maksimumi 8 për skanim). ${skipped ? `${skipped} faqe nuk u lexuan.` : ""} Për katalogë më të mëdhenj, skano edhe faqet e kategorive.`,
  };
}
export async function extractInstagram(businessId: string) {
  const { data, error } = await createServiceSupabase()
    .from("instagram_connections")
    .select("id,access_token_ciphertext,status,expires_at,username")
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
    fetchInstagramProfile(token),
  ]);
  if ("error" in result) throw new Error(result.error);
  const text = [JSON.stringify(profile.data), ...result.posts
    .map((p) =>
      JSON.stringify({
        caption: p.caption,
        url: p.permalink,
        image: p.imageUrl,
      }),
    )]
    .join("\n")
    .slice(0, 65000);
  if (!text) throw new Error("Nuk u gjet përmbajtje për analizë.");
  return {
    text,
    reference: `instagram:${data.username ?? businessId}`,
    connectionId: data.id as string,
    images: selectDiscoveryImages(result.posts),
    website: profile.data.website ?? null,
    postCount: result.posts.length,
    note: `U lexuan ${result.posts.length} postime${result.truncated ? " (lexim i pjesshëm)" : ""}. ${profile.note} Videot përfaqësohen vetëm nga thumbnail-i.`,
  };
}

async function fetchInstagramProfile(token: string): Promise<{
  data: { name?: string; username?: string; biography?: string; website?: string };
  note: string;
}> {
  // Profile fields vary between Graph versions and login products. A rejected
  // optional field must never prevent reading an otherwise valid connection.
  for (const fields of ["name,username,biography,website", "name,username"]) {
    try {
      const url = new URL(`https://graph.instagram.com/${graphVersion()}/me`);
      url.searchParams.set("fields", fields);
      url.searchParams.set("access_token", token);
      const response = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
      if (!response.ok) continue;
      const raw = await response.json();
      const data: Record<string, string> = {};
      for (const field of ["name", "username", "biography", "website"])
        if (typeof raw[field] === "string") data[field] = raw[field].slice(0, 2000);
      return { data, note: data.biography ? "U lexua edhe përshkrimi i profilit." : "Bio dhe website mund të plotësohen nëse API nuk i kthen." };
    } catch { /* Optional metadata; do not log token-bearing URLs. */ }
  }
  return { data: {}, note: "Metadata e profilit nuk u lexua; analiza përdor postimet." };
}
