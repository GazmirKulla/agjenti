import OpenAI from "@/lib/ai/openai";
import { prompt } from "@/lib/ai/prompts/files";
import { modelFor } from "@/lib/agents/model";
import { value, type Draft } from "@/lib/business-intelligence/model";
import { fieldKey, parseBusinessFields, type BusinessField } from "@/lib/items/fields";
import type { StockMode } from "@/lib/products/stock";
import { createServiceSupabase } from "@/lib/supabase/service";

/** Prompt text: prompts/onboarding/skeleti-i-produkteve.md */
export const PRODUCT_SKELETON_PROMPT = () => prompt("onboarding/skeleti-i-produkteve");

export type DiscoveredField = BusinessField & { evidence: string };
export type ProductSkeleton = { fields: DiscoveredField[]; stock: { mode: StockMode; evidence: string } | null };
const MAX_PROPOSED = 6;
const fold = (text: string) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase("sq");

const schema = { type: "object", additionalProperties: false, required: ["fields", "stock"], properties: {
  fields: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "type", "unit", "options", "customerChooses", "evidence"], properties: {
    label: { type: "string" }, type: { type: "string", enum: ["text", "number", "select", "boolean"] }, unit: { type: "string" },
    options: { type: "array", items: { type: "string" } }, customerChooses: { type: "boolean" }, evidence: { type: "string" },
  } } },
  stock: { type: "object", additionalProperties: false, required: ["mode", "evidence"], properties: {
    mode: { type: "string", enum: ["off", "tracked", "unique"] }, evidence: { type: "string" },
  } },
} };

/** What the onboarding scan found about the products, as the text every proposal must quote. */
export function skeletonSource(draft: Draft | null): string {
  const products = (draft?.entities ?? []).filter(e => e.target === "product").slice(0, 25).map(e =>
    ["name", "description", "category", "variants", "personalization", "requirements", "availability"]
      .map(field => { const text = value(e, field); return text ? `${field}: ${text}` : ""; }).filter(Boolean).join("\n"));
  const profile = (draft?.entities ?? []).find(e => e.target === "profile");
  const about = profile ? value(profile, "description") : null;
  return [about ? `business: ${about}` : "", ...products].filter(Boolean).join("\n\n").slice(0, 20000);
}

/**
 * The model's proposal, kept only where it holds: each field quotes the source exactly, passes the same
 * validation as the fields page, and is new to the business (by key and label). Nothing is saved here.
 */
export function checkSkeleton(raw: unknown, source: string, existing: BusinessField[], reserved: string[]): ProductSkeleton {
  const result = raw && typeof raw === "object" ? raw as { fields?: unknown; stock?: unknown } : {};
  const text = fold(source);
  const quoted = (evidence: unknown) => typeof evidence === "string" && evidence.trim().length >= 2 && text.includes(fold(evidence));
  const taken = new Set([...existing.flatMap(f => [f.key, fieldKey(f.label)]), ...reserved]);
  const fields: DiscoveredField[] = [];
  for (const item of Array.isArray(result.fields) ? result.fields : []) {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
    if (!quoted(row.evidence) || typeof row.label !== "string" || taken.has(fieldKey(row.label))) continue;
    const parsed = parseBusinessFields([{ label: row.label, type: row.type, unit: row.unit, options: row.options, variant: row.customerChooses === true }]);
    if ("error" in parsed || !parsed.fields[0]) continue;
    taken.add(parsed.fields[0].key);
    fields.push({ ...parsed.fields[0], evidence: String(row.evidence).trim() });
    if (fields.length === MAX_PROPOSED) break;
  }
  const stockRow = result.stock && typeof result.stock === "object" ? result.stock as { mode?: unknown; evidence?: unknown } : {};
  const stock = (stockRow.mode === "tracked" || stockRow.mode === "unique") && quoted(stockRow.evidence)
    ? { mode: stockRow.mode as StockMode, evidence: String(stockRow.evidence).trim() } : null;
  return { fields, stock };
}

/** The proposal for this business from its onboarding scan; empty when there is nothing to read or the model fails. */
export async function proposeProductSkeleton(businessId: string, existing: BusinessField[], reserved: string[]): Promise<ProductSkeleton> {
  const empty: ProductSkeleton = { fields: [], stock: null };
  const { data } = await createServiceSupabase().from("business_intelligence").select("data").eq("business_id", businessId).maybeSingle();
  const source = skeletonSource((data?.data ?? null) as Draft | null);
  if (!source.trim() || !process.env.OPENAI_API_KEY?.trim()) return empty;
  try {
    const response = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 }).responses.create({
      model: modelFor("utility"), store: false, max_output_tokens: 1500,
      instructions: PRODUCT_SKELETON_PROMPT(),
      input: JSON.stringify({ existingFields: [...existing.map(f => f.label), ...reserved], input: source }),
      text: { format: { type: "json_schema", name: "product_skeleton", strict: true, schema } },
    });
    if (response.status !== "completed") return empty;
    return checkSkeleton(JSON.parse(response.output_text), source, existing, reserved);
  } catch {
    // A convenience during onboarding: without a proposal the owner still has the category's fields.
    return empty;
  }
}
