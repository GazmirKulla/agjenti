"use server";
import { AGENT_INSTRUCTIONS_WRITER_PROMPT } from "./prompts";
import { withAiUsage } from "@/lib/ai/usage";

import { completeText } from "@/lib/ai/complete";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";


/** Counts the AI requests of this action against the business it authorizes. */
export async function generateAgentInstructions(...args: Parameters<typeof generateAgentInstructionsUnmetered>) {
  return withAiUsage(undefined, () => generateAgentInstructionsUnmetered(...args));
}
async function generateAgentInstructionsUnmetered(slug: string, _form?: FormData) {
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
      .select("title,body,intent_key")
      .eq("business_id", access.business.id)
      .eq("is_active", true)
      .order("sort_order")
      .limit(12),
  ]);

  const services = (knowledge ?? []).filter(k => k.intent_key === "service");
  if (!products?.length && !services.length)
    return {
      error:
        "Shto të paktën një produkt ose shërbim aktiv në katalog përpara se të gjenerosh udhëzimet.",
    };

  const catalog = (products ?? [])
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
    instructions: AGENT_INSTRUCTIONS_WRITER_PROMPT(),
    input: [
      `Biznesi: ${access.business.name}`,
      "Produkte aktive:",
      catalog,
      "Shërbime aktive:",
      services.map(k => `${k.title}: ${k.body}`).join("\n"),
      knowledgeTitles
        ? `Tema njohurish ekzistuese: ${knowledgeTitles}`
        : "Njohuri: ende të pakta",
    ].join("\n"),
  });

  if (!result.ok) return { error: result.error };
  return { text: result.text, success: "Udhëzimet u gjeneruan. Rishikoji dhe ruaji." };
}
