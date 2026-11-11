import { prompt } from "@/lib/ai/prompts/files";
import OpenAI from "@/lib/ai/openai";
import { modelFor } from "@/lib/agents/generate";
import { businessProfiles } from "@/lib/onboarding/rules";
import {
  fields,
  parseEntities,
  targets,
  type Source,
  type Target,
} from "./model";

/** Prompt text: prompts/burimet/njohja-e-biznesit.md */
export const ONBOARDING_EXTRACTION_PROMPT = (allowedFields: unknown) => prompt("burimet/njohja-e-biznesit", { llojet: JSON.stringify(Object.keys(businessProfiles)), fushat: JSON.stringify(allowedFields) });

/** Prompt text: prompts/burimet/nxjerrja-nga-materialet.md */
export const SOURCE_EXTRACTION_PROMPT = (target: string) => prompt("burimet/nxjerrja-nga-materialet", { objektivi: target, fushat: JSON.stringify(fields), llojet: JSON.stringify(Object.keys(businessProfiles)) });

const allFields = [
  ...new Set(Object.values(fields).flatMap((list) => [...list])),
];

export async function normalizeSource(
  text: string,
  source: Source,
  reference: string,
  target: Target,
  images: readonly { id: string; url: string; postUrl?: string | null }[] = [],
  purpose: "catalog" | "onboarding" = "catalog",
) {
  const onboarding = purpose === "onboarding";
  const allowedTargets = onboarding ? ["profile", "knowledge"] as const : targets;
  const allowedFields = onboarding ? { profile: fields.profile, knowledge: fields.knowledge } : fields;
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 60000,
    maxRetries: 0,
  });
  const response = await client.responses.create({
    model: images.length ? process.env.BUSINESS_VISION_MODEL?.trim() || modelFor("assistant") : modelFor("assistant"),
    store: false,
    max_output_tokens: 12000,
    instructions: SOURCE_EXTRACTION_PROMPT(target),
    // Onboarding builds context, never a catalog or an order workflow. The
    // schema and the post-response filter enforce this independently of prompts.
    ...(onboarding ? { instructions: ONBOARDING_EXTRACTION_PROMPT(allowedFields) } : {}),
    input: images.length ? [{
      role: "user" as const,
      content: [
        { type: "input_text" as const, text: `${text}\nImage evidence rules: each photo is labeled with its imageRef. For text evidence use evidenceKind=text and imageRef=null, quoting the source exactly. For legible text inside a photo use evidenceKind=ocr and quote it exactly. For directly visible objects/attributes use evidenceKind=visual and describe the observation. Always attach the provided imageRef to OCR/visual facts. Never infer price, currency, availability, materials, sizes, policies or personalization from appearance. Do not interpret clinical images or identify people. Do not extract businessType from images; business classification is a separate recommendation.` },
        ...images.flatMap((image) => [
          { type: "input_text" as const, text: `imageRef: ${image.id}; image URL: ${image.url}` },
          { type: "input_image" as const, image_url: image.url, detail: "auto" as const },
        ]),
      ],
    }] : text,
    text: {
      format: {
        type: "json_schema",
        name: "business_data",
        strict: true,
        schema: {
          type: "object",
          properties: {
            entities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  target: { type: "string", enum: [...allowedTargets] },
                  facts: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        field: { type: "string", enum: onboarding ? [...new Set(Object.values(allowedFields).flat())] : allFields },
                        value: { type: ["string", "null"] },
                        confidence: { type: "number" },
                        evidence: { type: ["string", "null"] },
                        evidenceKind: { type: "string", enum: ["text", "visual", "ocr"] },
                        imageRef: { type: ["string", "null"] },
                      },
                      required: ["field", "value", "confidence", "evidence", "evidenceKind", "imageRef"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["target", "facts"],
                additionalProperties: false,
              },
            },
          },
          required: ["entities"],
          additionalProperties: false,
        },
      },
    },
  });
  if (response.status !== "completed" || !response.output_text)
    throw new Error("Analiza nuk u përfundua. Provo përsëri.");
  const raw = JSON.parse(response.output_text).entities;
  if (onboarding && (!Array.isArray(raw) || raw.length > 60)) throw new Error("invalid_extraction");
  // Empty/irrelevant posts are successful reads, not missing-product errors.
  const scoped = onboarding && Array.isArray(raw) ? raw.filter(item => allowedTargets.includes(item?.target)) : raw;
  if (onboarding && Array.isArray(scoped) && !scoped.length) return [];
  return parseEntities(
    scoped,
    source,
    reference,
    text,
    images,
  );
}
