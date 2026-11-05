import { messageUnderstanding } from "@/lib/conversations/understanding/context";
import { foldText } from "@/lib/workflows/state";
import { type Catalog, parseMetadata } from "./model";
export type Requirements = Partial<
  Record<
    | "brand"
    | "year"
    | "category"
    | "industry"
    | "market"
    | "language"
    | "purpose"
    | "capacity",
    string
  >
>;
export type CatalogContext = {
  query: string;
  requirements: Requirements;
  pending?: keyof Requirements;
  turns: number;
};
export type Hit = {
  catalog_id: string;
  heading: string;
  body: string;
  page: number | null;
  semantic: number;
};
export function routeIntent(message: string) {
  return messageUnderstanding(message).retrievalDomain;
}
export function readContext(raw: unknown): CatalogContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.query !== "string" ||
    r.query.length > 2000 ||
    typeof r.turns !== "number" ||
    !Number.isInteger(r.turns) ||
    r.turns < 0 ||
    r.turns > 8
  )
    return null;
  const requirements: Requirements = {};
  if (r.requirements && typeof r.requirements === "object")
    for (const k of [
      "brand",
      "year",
      "category",
      "industry",
      "market",
      "language",
      "purpose",
      "capacity",
    ] as const) {
      const v = (r.requirements as Record<string, unknown>)[k];
      if (typeof v === "string") requirements[k] = v.slice(0, 300);
    }
  const pending =
    typeof r.pending === "string" &&
    [
      "brand",
      "year",
      "category",
      "industry",
      "market",
      "language",
      "purpose",
      "capacity",
    ].includes(r.pending)
      ? (r.pending as keyof Requirements)
      : undefined;
  return { query: r.query, requirements, pending, turns: r.turns };
}
function canonical(value: string) {
  return foldText(value).trim();
}
export function matches(values: string[], query: string) {
  // Requirements have already been semantically normalized against supported
  // metadata by the extractor. This is format equality, not phrase matching.
  const q = canonical(query);
  return Boolean(q) && values.some(value => canonical(value) === q);
}

export function rankCatalogs(
  catalogs: Catalog[],
  hits: Hit[],
  query: string,
  requirements: Requirements,
  now = Date.now(),
) {
  return catalogs
    .filter((c) => c.active && c.index_status === "ready" && c.confirmed_at)
    .flatMap((c) => {
      const m = parseMetadata(c.metadata);
      const sections = hits.filter((h) => h.catalog_id === c.id);
      // Explicit constraints must be supported, not merely absent from metadata.
      if (
        requirements.category &&
        !matches(m.categories.concat(m.productFamilies), requirements.category)
      )
        return [];
      if (requirements.brand && !matches(m.brands, requirements.brand))
        return [];
      if (requirements.year && !matches(m.years, requirements.year)) return [];
      if (requirements.market && !matches(m.markets, requirements.market))
        return [];
      if (requirements.language && !matches(m.languages, requirements.language))
        return [];
      if (
        requirements.industry &&
        !matches(m.industries, requirements.industry)
      )
        return [];
      const purpose = messageUnderstanding(query).catalogPurpose;
      const technical = purpose === "technical";
      const commercial = purpose === "commercial";
      if (
        technical &&
        !commercial &&
        c.use_when.includes("commercial") &&
        !c.use_when.includes("technical")
      )
        return [];
      if (
        commercial &&
        !technical &&
        c.use_when.includes("technical") &&
        !c.use_when.includes("commercial")
      )
        return [];
      const semantic = Math.max(0, ...sections.map((h) => h.semantic ?? 0));
      const intent = routeIntent(query);
      const rule = c.use_when.some(
        (r) =>
          (r === "full_range" && intent === "catalog") ||
          (r === "technical" && technical) ||
          (r === "commercial" && commercial) ||
          (r === "b2b" && purpose === "b2b") ||
          (r === "category" &&
            Boolean(requirements.category && matches(m.categories, requirements.category))),
      );
      const fresh = Math.max(
        0,
        1 - (now - Date.parse(c.updated_at)) / (365 * 86400000),
      );
      const score =
        semantic * 0.9 + (rule ? 0.08 : 0) + fresh * 0.02;
      return [
        { catalog: c, sections, score, relevance: semantic },
      ];
    })
    .sort((a, b) => b.score - a.score);
}
export const questions: Record<keyof Requirements, string> = {
  brand: "Për cilën markë po kërkoni?",
  year: "Cilin vit ose edicion të katalogut dëshironi?",
  category: "Për cilën kategori ose familje produktesh po kërkoni?",
  industry: "Për cilën industri po kërkoni?",
  market: "Në cilin shtet do ta përdorni?",
  language: "Në cilën gjuhë e dëshironi katalogun?",
  purpose: "Po kërkoni material teknik apo komercial?",
  capacity: "Çfarë kapaciteti ose specifikimi ju duhet?",
};
