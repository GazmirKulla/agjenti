import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/generate";
import type { Access } from "@/lib/business-assistant/service";
import { loadItemSetup } from "@/lib/items/business";
import { openImportToken, prepareImport } from "./import-service";
import { autoMapAttributes, readImportCsv, importFields, type ImportField, type ImportOptions } from "./import-model";
import { columnUses, describePlan, planNewFields, planOptions, validatePlan } from "./import-plan";

/** Prompt text: prompts/katalogu/importi-csv.md */
export const CSV_IMPORT_REVIEW_PROMPT = () => prompt("katalogu/importi-csv", { fushat: importFields.join(", ") });

/** The AI proposes a reading plan; the code checks it against the file and the business's fields.
 * The plan only links columns: the model never writes product values, prices or stock. The rows
 * are compared with the catalog with the parts that need no new field; the owner approves the
 * plan (which may add fields) before its full reading is used. */
export async function evaluateImport(access: Access, source: string, options: ImportOptions) {
  const { raw } = openImportToken(source, access, "product-import-source");
  const csv = readImportCsv(raw);
  if (!process.env.OPENAI_API_KEY)
    throw Error("Agjenti AI nuk është konfiguruar. Mund të vazhdosh me kontrollin e katalogut.");
  const { fields } = await loadItemSetup(access.businessId);
  // Columns known from their titles (or chosen by the owner) stay as they are.
  const mapped = Object.entries(options.mapping ?? {}).filter((e): e is [ImportField, number] => typeof e[1] === "number");
  const attributes = options.attributes ?? autoMapAttributes(csv.headers, fields, mapped.map(([, n]) => n));
  const known = [...mapped.map(([use, index]) => ({ index, use })), ...Object.entries(attributes).map(([fieldKey, index]) => ({ index, use: "field", fieldKey }))];
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45000, maxRetries: 0 });
  const result = await client.responses.create({
    model: modelFor("assistant"),
    store: false,
    instructions: CSV_IMPORT_REVIEW_PROMPT(),
    input: JSON.stringify({
      headers: csv.headers.map((title, index) => ({ index, title })),
      rows: csv.cells,
      businessFields: fields.map(f => ({ key: f.key, label: f.label, unit: f.unit ?? "", customerChooses: Boolean(f.variant) })),
      knownColumns: known.map(k => ({ index: k.index, use: k.use, ...("fieldKey" in k ? { field_key: k.fieldKey } : {}) })),
    }),
    text: { format: { type: "json_schema", name: "csv_reading_plan", strict: true, schema: {
      type: "object", additionalProperties: false, required: ["advice", "missing_price", "columns"],
      properties: {
        advice: { type: "string" },
        missing_price: { type: "string", enum: ["request", "empty"] },
        columns: { type: "array", items: { type: "object", additionalProperties: false,
          required: ["index", "use", "field_key", "label", "unit", "blank_values"],
          properties: { index: { type: "integer" }, use: { type: "string", enum: [...columnUses] }, field_key: { type: "string" },
            label: { type: "string" }, unit: { type: "string" }, blank_values: { type: "array", items: { type: "string" } } } } },
      },
    } } },
  });
  let parsed: { advice?: unknown; missing_price?: unknown; columns?: { index: unknown; use: unknown; field_key: unknown; label: unknown; unit: unknown; blank_values: unknown }[] };
  try { parsed = JSON.parse(result.output_text); } catch { throw Error("Agjenti nuk ktheu një plan të lexueshëm. Provo përsëri ose lidh kolonat vetë."); }
  const proposed = (Array.isArray(parsed.columns) ? parsed.columns : []).map(c => ({ index: c.index, use: c.use, fieldKey: c.field_key, label: c.label, unit: c.unit, blank: c.blank_values }));
  // Known columns come first, so a proposal for the same column or the same import field yields to them.
  const blanksOf = (index: number) => proposed.find(c => c.index === index)?.blank;
  const plan = validatePlan({ missingPrice: parsed.missing_price,
    columns: [...known.map(k => ({ ...k, blank: blanksOf(k.index) })), ...proposed.filter(c => !known.some(k => k.index === c.index))] }, csv.headers, csv.cells, fields);
  // Until the owner accepts the plan, columns for fields it would add are not read.
  const now = planOptions({ ...plan, columns: plan.columns.filter(c => c.use !== "field" && c.use !== "choice" || c.fieldKey) },
    { fields: options.fields, lines: options.lines, productTypeId: options.productTypeId, workflowId: options.workflowId });
  const preview = await prepareImport(access, source, now, fields);
  return {
    mapping: now.mapping,
    plan,
    planLines: describePlan(plan, csv.cells, fields),
    newFields: planNewFields(plan).map(f => f.label),
    preview: { ...preview, advice: String(parsed.advice ?? "").slice(0, 1500) },
  };
}
