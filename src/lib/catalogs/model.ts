export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 256;
export const useRules = [
  "full_range",
  "category",
  "b2b",
  "technical",
  "commercial",
] as const;
export type CatalogMetadata = {
  categories: string[];
  brands: string[];
  years: string[];
  productFamilies: string[];
  applications: string[];
  industries: string[];
  specifications: string[];
  terminology: string[];
  languages: string[];
  markets: string[];
  audiences: string[];
};
export type Catalog = {
  id: string;
  business_id: string;
  title: string;
  source_type: "pdf" | "text" | "website" | "url";
  source_url: string | null;
  storage_path: string | null;
  description: string;
  metadata: CatalogMetadata;
  index_metadata?: CatalogMetadata;
  ai_summary: string;
  use_when: string[];
  qualification_fields: string[];
  active: boolean;
  index_status: "pending" | "indexing" | "review" | "ready" | "failed";
  confirmed_at: string | null;
  updated_at: string;
  share_token: string;
  revision: number;
  index_error: string | null;
  coverage: string;
};
export type Section = {
  heading: string;
  text: string;
  page: number | null;
  keywords: string[];
  embedding?: number[];
};
export const emptyMetadata: CatalogMetadata = {
  categories: [],
  brands: [],
  years: [],
  productFamilies: [],
  applications: [],
  industries: [],
  specifications: [],
  terminology: [],
  languages: [],
  markets: [],
  audiences: [],
};
export const metadataLabels: Record<keyof CatalogMetadata, string> = {
  categories: "Kategori",
  brands: "Marka",
  years: "Viti / edicioni",
  productFamilies: "Familje produktesh",
  applications: "Përdorime",
  industries: "Industri",
  specifications: "Specifikime",
  terminology: "Terminologji",
  languages: "Gjuhë",
  markets: "Tregje / vende",
  audiences: "Audienca",
};
export const ruleLabels: Record<string, string> = {
  full_range: "Kërkon gamën e plotë",
  category: "Pyet për kategorinë",
  b2b: "Kërkesë B2B",
  technical: "Kërkesë teknike",
  commercial: "Katalog komercial",
};
export const qualificationLabels: Record<string, string> = {
  category: "Kategoria",
  brand: "Marka",
  year: "Viti / edicioni",
  industry: "Industria",
  market: "Shteti / tregu",
  language: "Gjuha e katalogut",
  purpose: "Teknik apo komercial",
  capacity: "Kapaciteti / specifikimi i kërkuar",
};
export function parseMetadata(raw: unknown): CatalogMetadata {
  const result = { ...emptyMetadata };
  for (const key of Object.keys(result) as (keyof CatalogMetadata)[]) {
    const v =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)[key]
        : null;
    result[key] = Array.isArray(v)
      ? v
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim().slice(0, 180))
          .filter(Boolean)
          .slice(0, 30)
      : [];
  }
  return result;
}
export function validateIndex(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("invalid_index");
  const r = raw as Record<string, unknown>;
  if (
    typeof r.summary !== "string" ||
    typeof r.coverage !== "string" ||
    !Array.isArray(r.sections) ||
    r.sections.length < 1 ||
    r.sections.length > 40
  )
    throw new Error("invalid_index");
  const sections: Section[] = r.sections.map((s) => {
    if (
      !s ||
      typeof s.heading !== "string" ||
      typeof s.text !== "string" ||
      s.text.trim().length < 5 ||
      s.text.length > 3000 ||
      !(
        s.page === null ||
        (Number.isInteger(s.page) && s.page > 0 && s.page < 10000)
      )
    )
      throw new Error("invalid_section");
    return {
      heading: s.heading.slice(0, 180),
      text: s.text,
      page: s.page,
      keywords: Array.isArray(s.keywords)
        ? s.keywords.filter((v: unknown) => typeof v === "string").slice(0, 20)
        : [],
    };
  });
  return {
    summary: r.summary.slice(0, 6000),
    coverage: r.coverage.slice(0, 1000),
    metadata: parseMetadata(r.metadata),
    sections,
  };
}
