import { foldText } from "@/lib/workflows/engine";
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
  const s = foldText(message);
  if (
    /\b(sku|stock|stok|cmim|cmimi|price|pricing|variant|kushton)\b/.test(s) &&
    !/\b(price list|lista e cmimeve|liste cmimesh)\b/.test(s)
  )
    return "product";
  if (
    /katalog|catalog|broshur|brochure|datasheet|data sheet|dokument|documentation|collection|koleksion|full range|gama|game|familj.*produkt|product famil|price list|lista e cmimeve/.test(
      s,
    )
  )
    return "catalog";
  return "general";
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
  const v = foldText(value).trim();
  const aliases: Record<string, string> = {
    en: "english",
    anglisht: "english",
    sq: "albanian",
    shqip: "albanian",
    de: "german",
    gjermanisht: "german",
    it: "italian",
    italisht: "italian",
    shqiperi: "albania",
    shqiperia: "albania",
    kosove: "kosovo",
    kosova: "kosovo",
    gjermani: "germany",
    gjermania: "germany",
    eu: "europe",
    evrope: "europe",
    evropa: "europe",
  };
  return aliases[v] ?? v;
}
export function matches(values: string[], query: string) {
  const q = canonical(query);
  return values.some((v) => {
    const s = canonical(v);
    return s === q || q.includes(s) || s.includes(q);
  });
}
export function rankCatalogs(
  catalogs: Catalog[],
  hits: Hit[],
  query: string,
  requirements: Requirements,
  now = Date.now(),
) {
  const tokens = foldText(query)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
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
      const purpose = foldText(requirements.purpose ?? query);
      const technical = /teknik|technical|datasheet/.test(purpose);
      const commercial = /komercial|commercial/.test(purpose);
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
      const hay = foldText(
        [c.title, c.description, ...Object.values(m).flat()].join(" "),
      );
      const lexical =
        tokens.filter((t) => hay.includes(t)).length /
        Math.max(tokens.length, 1);
      const semantic = Math.max(0, ...sections.map((h) => h.semantic ?? 0));
      const intent = routeIntent(query);
      const rule = c.use_when.some(
        (r) =>
          (r === "full_range" && intent === "catalog") ||
          (r === "technical" &&
            /teknik|technical|datasheet/i.test(
              query + " " + (requirements.purpose ?? ""),
            )) ||
          (r === "commercial" &&
            /komercial|commercial/i.test(
              query + " " + (requirements.purpose ?? ""),
            )) ||
          (r === "b2b" &&
            /b2b|distribut|wholesale|shumic|industrial/i.test(query)) ||
          (r === "category" &&
            m.categories.some((v) => foldText(query).includes(foldText(v)))),
      );
      const fresh = Math.max(
        0,
        1 - (now - Date.parse(c.updated_at)) / (365 * 86400000),
      );
      const score =
        semantic * 0.65 + lexical * 0.25 + (rule ? 0.08 : 0) + fresh * 0.02;
      return [
        { catalog: c, sections, score, relevance: Math.max(semantic, lexical) },
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
