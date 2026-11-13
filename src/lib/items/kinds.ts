/** What a business lists: a plain product, a property, a vehicle, a machine…
 * Every kind is stored as a product; the kind adds its own fields, its own
 * words in the menu and its own availability wording. Adding a kind is adding
 * an entry here — no new table, page or agent tool. */

export type FieldType = "text" | "number" | "select" | "boolean";
export type KindField = {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Shown next to the name in lists. */
  summary?: boolean;
  placeholder?: string;
};
export type Availability = "available" | "reserved" | "sold" | "rented";
export type ItemKind = {
  id: string;
  /** Menu and page name, e.g. "Listimet". */
  plural: string;
  /** One item, e.g. "listim" — used in buttons such as "Shto listim". */
  singular: string;
  description: string;
  /** Page titles with correct Albanian forms. */
  detailTitle: string;
  newTitle: string;
  fields: KindField[];
  /** Which availability states make sense for this kind (first = default). */
  availability: Availability[];
};

export const ITEM_KINDS: Record<string, ItemKind> = {
  product: {
    id: "product", plural: "Produktet", singular: "produkt",
    description: "Artikuj që shiten dhe porositen.",
    detailTitle: "Detajet e produktit", newTitle: "Shto produkt të ri",
    fields: [], availability: ["available", "sold"],
  },
  property: {
    id: "property", plural: "Listimet", singular: "listim",
    description: "Prona për shitje ose me qira: apartamente, shtëpi, zyra, toka.",
    detailTitle: "Detajet e listimit", newTitle: "Shto listim të ri",
    availability: ["available", "reserved", "sold", "rented"],
    fields: [
      { key: "deal", label: "Shitje apo qira", type: "select", summary: true, options: [{ value: "sale", label: "Shitje" }, { value: "rent", label: "Qira" }] },
      { key: "property_type", label: "Lloji i pronës", type: "select", summary: true, options: [
        { value: "apartment", label: "Apartament" }, { value: "house", label: "Shtëpi / vilë" }, { value: "office", label: "Zyrë" },
        { value: "shop", label: "Dyqan / ambient" }, { value: "land", label: "Tokë" }, { value: "garage", label: "Garazh" }] },
      { key: "city", label: "Qyteti", type: "text", summary: true, placeholder: "P.sh. Tiranë" },
      { key: "area", label: "Zona", type: "text", placeholder: "P.sh. Blloku" },
      { key: "size_m2", label: "Sipërfaqja", type: "number", unit: "m²", summary: true },
      { key: "rooms", label: "Dhomat", type: "text", summary: true, placeholder: "P.sh. 2+1" },
      { key: "floor", label: "Kati", type: "number" },
      { key: "furnished", label: "E mobiluar", type: "boolean" },
    ],
  },
  vehicle: {
    id: "vehicle", plural: "Automjetet", singular: "automjet",
    description: "Makina, motorë dhe mjete për shitje ose me qira.",
    detailTitle: "Detajet e automjetit", newTitle: "Shto automjet të ri",
    availability: ["available", "reserved", "sold", "rented"],
    fields: [
      { key: "make", label: "Marka", type: "text", summary: true, placeholder: "P.sh. Volkswagen" },
      { key: "model", label: "Modeli", type: "text", summary: true, placeholder: "P.sh. Golf" },
      { key: "year", label: "Viti", type: "number", summary: true },
      { key: "mileage_km", label: "Kilometrat", type: "number", unit: "km", summary: true },
      { key: "fuel", label: "Karburanti", type: "select", options: [
        { value: "diesel", label: "Naftë" }, { value: "petrol", label: "Benzinë" }, { value: "hybrid", label: "Hibrid" },
        { value: "electric", label: "Elektrik" }, { value: "lpg", label: "Gaz" }] },
      { key: "gearbox", label: "Kambio", type: "select", options: [{ value: "manual", label: "Manuale" }, { value: "automatic", label: "Automatike" }] },
      { key: "deal", label: "Shitje apo qira", type: "select", options: [{ value: "sale", label: "Shitje" }, { value: "rent", label: "Qira" }] },
    ],
  },
  equipment: {
    id: "equipment", plural: "Pajisjet", singular: "pajisje",
    description: "Makineri dhe pajisje pune, për shitje ose me qira ditore.",
    detailTitle: "Detajet e pajisjes", newTitle: "Shto pajisje të re",
    availability: ["available", "reserved", "sold", "rented"],
    fields: [
      { key: "category", label: "Kategoria", type: "text", summary: true, placeholder: "P.sh. Eskavator" },
      { key: "brand", label: "Marka", type: "text", summary: true },
      { key: "year", label: "Viti", type: "number" },
      { key: "power", label: "Fuqia", type: "text", placeholder: "P.sh. 75 kW" },
      { key: "weight_kg", label: "Pesha", type: "number", unit: "kg" },
      { key: "deal", label: "Shitje apo qira", type: "select", summary: true, options: [{ value: "sale", label: "Shitje" }, { value: "rent", label: "Qira" }, { value: "both", label: "Të dyja" }] },
      { key: "daily_rate", label: "Çmimi i qirasë në ditë", type: "number" },
    ],
  },
};

export const availabilityLabels: Record<Availability, string> = {
  available: "I lirë", reserved: "I rezervuar", sold: "I shitur", rented: "Me qira",
};

/** The kind a business starts with, from its onboarding category. */
const categoryKinds: Record<string, string> = { realestate: "property", automotive: "vehicle", equipment: "equipment" };
export function kindForCategory(category: string | null | undefined) {
  return categoryKinds[category ?? ""] ?? "product";
}

export function itemKind(id: string | null | undefined): ItemKind {
  return ITEM_KINDS[id ?? ""] ?? ITEM_KINDS.product;
}

/** What the business calls its items: the owner's own words win over the kind's. */
export function itemNames(kindId: string | null | undefined, custom?: { plural?: string | null; singular?: string | null }) {
  const kind = itemKind(kindId);
  return { plural: custom?.plural?.trim() || kind.plural, singular: custom?.singular?.trim() || kind.singular };
}

/** Page titles: the kind's own wording, or neutral wording for the owner's own names. */
export function itemTitles(kindId: string | null | undefined, custom?: { plural?: string | null; singular?: string | null }) {
  const kind = itemKind(kindId);
  if (custom?.singular?.trim()) return { detail: `Detajet: ${custom.singular.trim()}`, create: `Shto: ${custom.singular.trim()}` };
  return { detail: kind.detailTitle, create: kind.newTitle };
}

/** Reads the kind's fields from a form ("attr_<key>"), dropping anything unknown. */
export function parseAttributes(kindId: string, form: FormData, extra: KindField[] = []): { attributes: Record<string, string | number | boolean>; error?: string } {
  const attributes: Record<string, string | number | boolean> = {};
  for (const field of fieldsOf(kindId, extra)) {
    const raw = form.get(`attr_${field.key}`);
    if (field.type === "boolean") { if (raw === "on") attributes[field.key] = true; continue; }
    const text = String(raw ?? "").trim();
    if (!text) continue;
    if (field.type === "number") {
      const n = Number(text.replace(",", "."));
      if (!Number.isFinite(n) || n < 0) return { attributes, error: `“${field.label}” duhet të jetë numër.` };
      attributes[field.key] = n;
    } else if (field.type === "select") {
      if (!field.options?.some((o) => o.value === text)) return { attributes, error: `Zgjidh një vlerë për “${field.label}”.` };
      attributes[field.key] = text;
    } else {
      attributes[field.key] = text.slice(0, 120);
    }
  }
  return { attributes };
}

export function parseAvailability(kindId: string, value: unknown): Availability {
  const allowed = itemKind(kindId).availability;
  return allowed.includes(value as Availability) ? (value as Availability) : allowed[0];
}

function formatValue(field: KindField, value: unknown) {
  if (field.type === "boolean") return value === true ? "Po" : null;
  if (field.type === "select") return field.options?.find((o) => o.value === value)?.label ?? null;
  if (value === undefined || value === null || value === "") return null;
  const text = field.type === "number" ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ") : String(value);
  return field.unit ? `${text} ${field.unit}` : text;
}

/** The kind's own fields followed by the business's own ones (a business field never replaces a kind field). */
export function fieldsOf(kindId: string | null | undefined, extra: KindField[] = []): KindField[] {
  const own = itemKind(kindId).fields;
  return [...own, ...extra.filter(f => !own.some(o => o.key === f.key))];
}

/** "Shitje · Apartament · Tiranë · 120 m² · 2+1" — the fields marked for lists. */
export function attributeSummary(kindId: string | null | undefined, attributes: unknown, extra: KindField[] = []) {
  const values = attributes && typeof attributes === "object" ? (attributes as Record<string, unknown>) : {};
  return fieldsOf(kindId, extra).filter((f) => f.summary).map((f) => formatValue(f, values[f.key])).filter(Boolean).join(" · ");
}

/** Every filled field with its label, for the agent: "Sipërfaqja: 120 m²; Dhomat: 2+1". */
export function attributeDetails(kindId: string | null | undefined, attributes: unknown, extra: KindField[] = []) {
  const values = attributes && typeof attributes === "object" ? (attributes as Record<string, unknown>) : {};
  return fieldsOf(kindId, extra).flatMap((f) => {
    const text = formatValue(f, values[f.key]);
    return text ? [`${f.label}: ${text}`] : [];
  }).join("; ");
}
