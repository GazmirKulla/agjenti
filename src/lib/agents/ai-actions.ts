"use server";

import { completeText } from "@/lib/ai/complete";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export async function generateAgentInstructions(slug: string, _form?: FormData) {
  const user = await getSessionUser();
  if (!user) return { error: "Sesioni ka skaduar. Hyr përsëri." };
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) return { error: "Nuk ke qasje në këtë biznes." };

  const db = createServiceSupabase();
  const [{ data: products }, { data: knowledge }] = await Promise.all([
    db
      .from("products")
      .select("name,description,price_amount,currency,product_types(name)")
      .eq("business_id", access.business.id)
      .eq("is_active", true)
      .order("name")
      .limit(40),
    db
      .from("knowledge_entries")
      .select("title")
      .eq("business_id", access.business.id)
      .eq("is_active", true)
      .order("sort_order")
      .limit(12),
  ]);

  if (!products?.length)
    return {
      error:
        "Shto të paktën një produkt aktiv në katalog përpara se të gjenerosh udhëzimet.",
    };

  const catalog = products
    .map((p) => {
      const type = Array.isArray(p.product_types)
        ? p.product_types[0]?.name
        : (p.product_types as { name?: string } | null)?.name;
      const price =
        p.price_amount == null ? "pa çmim" : `${p.price_amount} ${p.currency}`;
      const desc = (p.description ?? "").trim();
      return `- ${p.name} (${price})${type ? ` [${type}]` : ""}${desc ? `: ${desc}` : ""}`;
    })
    .join("\n");

  const knowledgeTitles = (knowledge ?? [])
    .map((k) => k.title)
    .filter(Boolean)
    .join("; ");

  const result = await completeText({
    maxChars: 1800,
    instructions: [
      "Je arkitekt promptesh për një agjent shitjesh / support në Instagram DM.",
      "Shkruaj udhëzime operative në shqip për agjentin e biznesit.",
      "Përfshi: tonin, gjuhën, rregulla (mos shpik çmime/stok/politika), si të përdorë katalogun,",
      "si të ndihmojë zgjedhjen e produktit, dhe si të ndjekë workflow-n e porosisë pa thënë se u krye pa konfirmim.",
      "Përshtat udhëzimet me produktet reale të biznesit (çfarë shet, si t’i përshkruajë).",
      "3–6 paragrafë të shkurtër. Pa markdown headings. Pa emoji. Kthe vetëm tekstin e udhëzimeve.",
    ].join(" "),
    input: [
      `Biznesi: ${access.business.name}`,
      "Produkte aktive:",
      catalog,
      knowledgeTitles
        ? `Tema njohurish ekzistuese: ${knowledgeTitles}`
        : "Njohuri: ende të pakta",
    ].join("\n"),
  });

  if (!result.ok) return { error: result.error };
  return { text: result.text, success: "Udhëzimet u gjeneruan. Rishikoji dhe ruaji." };
}
