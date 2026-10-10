import { AssistantError } from "./model";
export type AssistantUIContext = {
  page: string;
  entityType?: "product" | "service" | "knowledge" | "booking" | "agent";
  entityId?: string;
  searchQuery?: string;
  filters?: { status: string };
  selectedEntityIds?: string[];
  entryPoint: "home" | "contextual";
};
const pages = [
  "home",
  "products",
  "services",
  "knowledge",
  "bookings",
  "calendar",
  "agents",
  "settings",
  "inbox",
  "orders",
  "customers",
  "leads",
  "catalogs",
  "sources",
  "instagram",
  "workflows",
  "account",
  "setup",
  "staff",
];
const entities: Record<string, string> = {
  products: "product",
  services: "service",
  knowledge: "knowledge",
  bookings: "booking",
  agents: "agent",
};
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseUIContext(raw: unknown): AssistantUIContext | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new AssistantError("Konteksti i faqes nuk është i vlefshëm.");
  const c = raw as Record<string, unknown>;
  if (
    typeof c.page !== "string" ||
    !pages.includes(c.page) ||
    !["home", "contextual"].includes(String(c.entryPoint))
  )
    throw new AssistantError("Faqja nuk është e vlefshme.");
  if (c.entityId !== undefined || c.entityType !== undefined) {
    if (
      typeof c.entityId !== "string" ||
      !idPattern.test(c.entityId) ||
      c.entityType !== entities[c.page] ||
      !c.entityType
    )
      throw new AssistantError("Elementi i zgjedhur nuk është i vlefshëm.");
  }
  if (c.searchQuery !== undefined && (typeof c.searchQuery !== 'string' || c.searchQuery.length > 200)) throw new AssistantError('Kërkimi është shumë i gjatë.');
  if (c.selectedEntityIds !== undefined && (c.page !== 'products' || !Array.isArray(c.selectedEntityIds) || c.selectedEntityIds.length > 20 || c.selectedEntityIds.some(id => typeof id !== 'string' || !idPattern.test(id)))) throw new AssistantError('Zgjidh deri në 20 produkte për kontekst. Veprimet kryhen një nga një.');
  const status = c.filters && typeof c.filters === 'object' ? (c.filters as Record<string,unknown>).status : undefined;
  if(c.filters !== undefined && (c.page !== 'products' || typeof status !== 'string' || !['all','active','draft','unlinked','imports'].includes(status))) throw new AssistantError('Filtri nuk është i vlefshëm.');
  const selectedIds = Array.isArray(c.selectedEntityIds) ? [...new Set(c.selectedEntityIds as string[])] : [];
  if(c.entityId && selectedIds.length && !selectedIds.includes(c.entityId as string)) throw new AssistantError("Zgjedhja e produktit ndryshoi. Provo përsëri.");
  return {
    ...(selectedIds.length === 1 ? {entityType:"product" as const,entityId:selectedIds[0]} : {}),
    page: c.page,
    ...(typeof c.searchQuery === "string" ? {searchQuery:c.searchQuery} : {}),
    ...(status ? {filters:{status:status as string}} : {}),
    ...(Array.isArray(c.selectedEntityIds) ? {selectedEntityIds:[...new Set(c.selectedEntityIds as string[])]} : {}),
    entryPoint: c.entryPoint as AssistantUIContext["entryPoint"],
    ...(c.entityId
      ? {
          entityId: c.entityId as string,
          entityType: c.entityType as AssistantUIContext["entityType"],
        }
      : {}),
  };
}
export function contextFromPath(
  path: string,
  slug: string,
): AssistantUIContext {
  const base = `/b/${slug}`;
  const parts = path.startsWith(`${base}/`)
    ? path.slice(base.length + 1).split("/")
    : [];
  const page = pages.includes(parts[0]) ? parts[0] : "home";
  return {
    page,
    entryPoint: page === "home" ? "home" : "contextual",
    ...(entities[page] && idPattern.test(parts[1] ?? "")
      ? {
          entityType: entities[page] as AssistantUIContext["entityType"],
          entityId: parts[1],
        }
      : {}),
  };
}
export function contextLabel(c: AssistantUIContext) {
  return (
    (
      {
        home: "Kreu",
        products: "Produktet",
        services: "Shërbimet",
        knowledge: "Njohuria",
        bookings: "Takimet",
        calendar: "Kalendari",
        agents: "Agjenti AI",
        settings: "Profili i biznesit",
        inbox: "Inbox",
        orders: "Porositë",
      } as Record<string, string>
    )[c.page] ?? "Biznesi"
  );
}
export function assistantSuggestions(
  c: AssistantUIContext,
  modules: string[],
  external = false,
) {
  const all = [
    {
      module: "products",
      label: "Shto produkt",
      text: "Dua të shtoj një produkt të ri.",
      blocked: external,
    },
    {
      module: "products",
      label: "Ndrysho produktin",
      text:
        c.entityType === "product"
          ? "Dua të ndryshoj këtë produkt."
          : "Dua të ndryshoj një produkt.",
      blocked: external,
    },
    {
      module: "services",
      label: "Shto shërbim",
      text: "Dua të shtoj një shërbim të ri.",
    },
    {
      module: "knowledge",
      label: "Përditëso njohuritë",
      text: "Dua të përditësoj njohuritë e biznesit.",
    },
    {
      module: "bookings",
      label: "Gjej orar të lirë",
      text: "Dua të kontrolloj oraret e lira për një takim.",
    },
    {
      module: "agents",
      label: "Përditëso udhëzimet",
      text: "Dua të përditësoj udhëzimet e Agjentit.",
    },
  ].filter((a) => modules.includes(a.module) && !a.blocked);
  return c.page === "home"
    ? all.filter((a) => a.label !== "Ndrysho produktin").slice(0, 4)
    : all.filter(
        (a) =>
          a.module === c.page ||
          (c.page === "calendar" && a.module === "bookings"),
      );
}
