import { businessProfiles } from "@/lib/onboarding/rules";
export const targets = [
  "profile",
  "product",
  "agent",
  "knowledge",
  "workflow",
  "service",
] as const;
export type Target = (typeof targets)[number];
export const sources = [
  "audio",
  "website",
  "instagram",
  "manual",
  "ai_inferred",
] as const;
export type Source = (typeof sources)[number];
export const fields = {
  profile: [
    "name",
    "description",
    "businessType",
    "category",
    "contact",
    "shipping",
    "returns",
    "policies",
  ],
  product: [
    "name",
    "description",
    "category",
    "price",
    "currency",
    "variants",
    "personalization",
    "requirements",
    "orderInstructions",
    "imageUrl",
    "availability",
  ],
  agent: ["tone", "rules", "handoffRules", "salesBehavior", "orderBehavior"],
  knowledge: ["title", "body"],
  service: ["name", "description", "price", "currency", "requirements"],
  workflow: ["name", "steps"],
} as const;
export const labels: Record<string, string> = {
  profile: "Profili i biznesit",
  product: "Produkt",
  agent: "Udhëzimet e Agjentit",
  knowledge: "Njohuri / FAQ",
  workflow: "Workflow",
  service: "Shërbim",
  name: "Emri",
  title: "Titulli",
  body: "Përmbajtja",
  description: "Përshkrimi",
  businessType: "Lloji i biznesit",
  category: "Kategoria",
  contact: "Kontakti",
  shipping: "Transporti",
  returns: "Kthimet",
  policies: "Politikat",
  price: "Çmimi",
  currency: "Monedha",
  variants: "Variantet",
  personalization: "Personalizimi",
  requirements: "Të dhënat që duhen nga klienti",
  orderInstructions: "Udhëzimet e porosisë",
  imageUrl: "Linku i fotos",
  availability: "Disponueshmëria",
  tone: "Toni",
  rules: "Rregullat",
  handoffRules: "Kalimi te stafi",
  salesBehavior: "Sjellja në shitje",
  orderBehavior: "Sjellja për porositë",
  steps:
    "Hapat (një për rresht: text|Pyetja, photo|Foto, customer|Adresa, confirm|Konfirmimi)",
};
export type Fact = {
  field: string;
  value: string | null;
  source: Source;
  sourceRef: string;
  confidence: number;
  evidence: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedByUser: boolean;
};
export type Entity = { id: string; target: Target; facts: Fact[] };
export type Conflict = {
  entityId: string;
  field: string;
  current: Fact;
  incoming: Fact;
};
export type Draft = {
  entities: Entity[];
  conflicts: Conflict[];
  missingInformation: string[];
  suggestedClarifications: string[];
};
export const equivalent = (a: string | null, b: string | null) =>
  (a ?? "").trim().toLocaleLowerCase() === (b ?? "").trim().toLocaleLowerCase();
export function emptyDraft(): Draft {
  return {
    entities: [],
    conflicts: [],
    missingInformation: [],
    suggestedClarifications: [],
  };
}
export function value(entity: Entity, field: string) {
  return entity.facts.find((f) => f.field === field)?.value ?? "";
}
export function mergeDraft(current: Draft, incoming: Entity[]): Draft {
  const result: Draft = structuredClone(current);
  for (const item of incoming) {
    const entity = result.entities.find(
      (e) =>
        e.target === item.target &&
        (["profile", "agent"].includes(e.target) ||
          equivalent(
            value(e, "name") || value(e, "title"),
            value(item, "name") || value(item, "title"),
          )),
    );
    if (!entity) {
      result.entities.push(item);
      continue;
    }
    for (const fact of item.facts) {
      if (fact.value === null) continue;
      const prior = entity.facts.find((f) => f.field === fact.field);
      if (!prior || prior.value === null) {
        entity.facts = entity.facts
          .filter((f) => f.field !== fact.field)
          .concat(fact);
        continue;
      }
      if (equivalent(prior.value, fact.value)) continue;
      if (
        !result.conflicts.some(
          (c) =>
            c.entityId === entity!.id &&
            c.field === fact.field &&
            equivalent(c.incoming.value, fact.value),
        )
      )
        result.conflicts.push({
          entityId: entity.id,
          field: fact.field,
          current: prior,
          incoming: fact,
        });
    }
  }
  return withMissing(result);
}
export function withMissing(draft: Draft): Draft {
  const missing = draft.entities.flatMap((e) => {
    const required =
      e.target === "product"
        ? ["name", "price", "currency"]
        : e.target === "workflow"
          ? ["name", "steps"]
          : e.target === "knowledge"
            ? ["title", "body"]
            : e.target === "agent"
              ? ["rules"]
              : ["name"];
    return required
      .filter((f) => !value(e, f).trim())
      .map((f) => `${e.id}:${f}`);
  });
  return {
    ...draft,
    missingInformation: missing,
    suggestedClarifications: missing.map(
      (k) => `Plotëso: ${labels[k.split(":").at(-1)!] ?? k}.`,
    ),
  };
}
export function parseEntities(
  raw: unknown,
  source: Source,
  sourceRef: string,
  text: string,
): Entity[] {
  if (!Array.isArray(raw) || raw.length > 60)
    throw new Error("invalid_extraction");
  const now = new Date().toISOString();
  return raw.map((item) => {
    if (
      !item ||
      !targets.includes(item.target) ||
      !Array.isArray(item.facts) ||
      item.facts.length > 20
    )
      throw new Error("invalid_extraction");
    const target = item.target as Target;
    const seen = new Set<string>();
    const facts: Fact[] = item.facts.map((f: Record<string, unknown>) => {
      if (
        typeof f.field !== "string" ||
        !(fields[target] as readonly string[]).includes(f.field) ||
        seen.has(f.field)
      )
        throw new Error("invalid_field");
      seen.add(f.field);
      if (
        f.value !== null &&
        (typeof f.value !== "string" || f.value.length > 8000)
      )
        throw new Error("invalid_value");
      const evidence = typeof f.evidence === "string" ? f.evidence : null;
      const supported =
        source === "manual" || !!(evidence && text.includes(evidence));
      let v = supported
        ? typeof f.value === "string"
          ? f.value.trim() || null
          : null
        : null;
      if (
        f.field === "businessType" &&
        v &&
        !Object.hasOwn(businessProfiles, v)
      )
        v = null;
      if (
        f.field === "imageUrl" &&
        v &&
        (!/^https?:\/\//.test(v) || !text.includes(v))
      )
        v = null;
      return {
        field: f.field,
        value: v,
        source,
        sourceRef,
        confidence:
          v === null
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  typeof f.confidence === "number" ? f.confidence : 0,
                ),
              ),
        evidence,
        createdAt: now,
        updatedAt: now,
        confirmedByUser: false,
      };
    });
    return { id: crypto.randomUUID(), target, facts };
  });
}
export function validateForApply(entities: Entity[]) {
  if (!entities.length || entities.length > 60)
    throw new Error("Zgjidh të paktën një element.");
  for (const e of entities) {
    if (!targets.includes(e.target)) throw new Error("Lloj i pavlefshëm.");
    for (const f of e.facts)
      if (
        !(fields[e.target] as readonly string[]).includes(f.field) ||
        (f.value !== null &&
          (typeof f.value !== "string" || f.value.length > 8000))
      )
        throw new Error("Fushë e pavlefshme.");
    if (
      withMissing({ ...emptyDraft(), entities: [e] }).missingInformation.length
    )
      throw new Error("Plotëso fushat e kërkuara përpara ruajtjes.");
    if (
      ["product", "service"].includes(e.target) &&
      value(e, "price") &&
      (!Number.isFinite(Number(value(e, "price"))) ||
        Number(value(e, "price")) < 0)
    )
      throw new Error("Çmimi duhet të jetë numër pozitiv.");
    if (value(e, "currency") && !/^[A-Z]{3}$/.test(value(e, "currency")))
      throw new Error(
        "Monedha duhet të jetë ALL, EUR ose kod tjetër me 3 shkronja.",
      );
    if (value(e, "imageUrl") && !/^https?:\/\//.test(value(e, "imageUrl")))
      throw new Error("Fotoja duhet të jetë një link http ose https.");
    if (
      e.target === "profile" &&
      value(e, "businessType") &&
      !Object.hasOwn(businessProfiles, value(e, "businessType"))
    )
      throw new Error("Lloji i biznesit nuk mbështetet.");
    if (e.target === "workflow") parseSteps(value(e, "steps"));
  }
}
export function parseSteps(text: string) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 20)
    throw new Error("Workflow duhet të ketë 1–20 hapa.");
  return lines.map((line, i) => {
    const [kind, ...rest] = line.split("|");
    const label = rest.join("|").trim();
    if (!["text", "photo", "customer", "confirm"].includes(kind) || !label)
      throw new Error(
        "Përdor formatin text|Pyetja, photo|Foto, customer|Adresa ose confirm|Konfirmimi.",
      );
    return { key: `step_${i + 1}`, kind, label };
  });
}
