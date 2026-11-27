import type { NavItem } from "./builder";

/** `also`: pages reached from inside this space that keep it highlighted (e.g. sources inside Knowledge). */
export type WorkspaceLink = { id: string; path: string; label: string; icon: string; also?: string[] };
const workspaceLabels: Record<string, string> = {
  products: "Produktet", services: "Shërbimet", catalogs: "Katalogët",
  orders: "Porositë", bookings: "Rezervimet", leads: "Leads",
  agents: "Si flet dhe kur thërret stafin", knowledge: "Oferta", sources: "Burimet", workflows: "Workflow Designer",
};
export function workspaceLabel(item: WorkspaceLink & { custom?: true }) { return item.custom ? item.label : workspaceLabels[item.id] ?? item.label; }
export type WorkspaceSection = "home" | "conversations" | "agent" | "activity" | "reports" | "settings" | "integrations" | "business" | "products" | "services" | "orders" | "leads" | "customers";
const standaloneIds = ["products", "services", "orders", "leads", "customers"] as const;
const agentIds = new Set(["agents", "knowledge", "workflows", "sources"]);
const settingsIds = new Set(["settings"]);
const integrationIds = new Set(["channels"]);
/** Pages that belong to the channels section (the old per-channel pages included). */
const channelPaths = ["integrations", "instagram", "whatsapp"];
/** Modules shown as their own top-level entry, never inside a group. */
const ownEntryIds = new Set(["activity", "reports"]);

/** Presentation only: keep module permissions, URLs and page implementations intact. */
export function organizeWorkspace(allItems: NavItem[]) {
  // Sources live inside Knowledge ("Nga ku mëson Agjenti"); the page stays reachable from there.
  // The calendar is a tab of Rezervimet (its old URL redirects there), never an entry of its own.
  const items = allItems.filter(item => item.id !== "sources" && item.id !== "calendar");
  const hasAgent = items.some(item => item.id === "agents");
  // Topics the owner thinks in, shown only when the business uses them: its own profile, what it offers, orders and
  // bookings, how the agent talks; then the test. Knowledge, sources, memory and history live inside these topics.
  const has = (id: string) => items.some(item => item.id === id);
  const sells = has("orders"), books = has("bookings") || has("services");
  const agent: WorkspaceLink[] = [
    ...(hasAgent ? [{ id: "agent-business", path: "agents/business", label: "Biznesi", icon: "briefcase" }] : []),
    ...items.filter(item => item.id === "knowledge").map(item => ({ ...item, label: "Oferta", also: ["sources", ...(hasAgent ? ["agents/training"] : [])] })),
    ...(hasAgent && sells ? [{ id: "agent-orders", path: "agents/orders", label: "Kur klienti porosit", icon: "orders" }] : []),
    ...(hasAgent && books ? [{ id: "agent-bookings", path: "agents/bookings", label: "Kur klienti rezervon", icon: "calendar" }] : []),
    // "Çfarë bën Agjenti" (every capability on one page) stays for older links, inside this topic.
    ...items.filter(item => item.id === "agents").map(item => ({ ...item, label: "Si flet dhe kur thërret stafin", also: ["agents/memory", "agents/process"] })),
    ...(hasAgent ? [{ id: "agent-test", path: "agents/test", label: "Prova dhe kontrolli", icon: "spark" }] : []),
    // The workflow editor stays under "Avancuar".
    ...items.filter(item => item.id === "workflows"),
  ];
  const settings: WorkspaceLink[] = items.filter(item => settingsIds.has(item.id)).sort((a, b) => Number(b.id === "settings") - Number(a.id === "settings")).map(item => ({ ...item, label: item.id === "settings" ? "Biznesi dhe modulet" : item.label }));
  settings.push(
    { id: "setup", path: "setup", label: "Onboarding", icon: "spark" },
    { id: "billing", path: "billing", label: "Paketa dhe pagesat", icon: "billing" },
  );
  const integrations: WorkspaceLink[] = items.filter(item => integrationIds.has(item.id));
  const business = items.filter(item => !agentIds.has(item.id) && !settingsIds.has(item.id) && !integrationIds.has(item.id) && !ownEntryIds.has(item.id) && !["dashboard", "inbox", ...standaloneIds].includes(item.id));
  const groups = [
    { label: "Oferta", items: business.filter(item => ["products", "services", "catalogs"].includes(item.id)) },
    { label: "Operacionet", items: business.filter(item => ["orders", "bookings"].includes(item.id)) },
    { label: "Marrëdhëniet", items: business.filter(item => ["customers", "leads"].includes(item.id)) },
    { label: "Të tjera", items: business.filter(item => !["products", "services", "catalogs", "orders", "bookings", "calendar", "customers", "leads"].includes(item.id)) },
  ].filter(group => group.items.length);
  const primary: (WorkspaceLink & { section: WorkspaceSection })[] = [
    { id: "home", section: "home", path: "", label: "Kreu", icon: "home" },
    { id: "conversations", section: "conversations", path: "inbox", label: "Bisedat", icon: "inbox" },
    ...standaloneIds.flatMap(id => {
      const item = items.find(item => item.id === id);
      return item ? [{ ...item, section: id }] : [];
    }),
    ...(agent.some(item => item.id === "agents") ? [{ id: "agent", section: "agent" as const, path: "agents", label: "Agjenti i klientëve", icon: "agents" }] : []),
    ...(items.some(item => item.id === "activity") ? [{ id: "activity", section: "activity" as const, path: "activity", label: "Aktiviteti", icon: "history" }] : []),
    ...(items.some(item => item.id === "reports") ? [{ id: "reports", section: "reports" as const, path: "reports", label: "Raportet", icon: "reports" }] : []),
    ...(integrations.length ? [{ id: "integrations", section: "integrations" as const, path: "integrations", label: "Kanalet", icon: "integrations" }] : []),
    { id: "settings", section: "settings", path: "settings", label: "Cilësimet", icon: "settings" },
  ];
  // Pages inside the agent spaces stay findable by name.
  const inner: WorkspaceLink[] = hasAgent ? [
    { id: "agent-training", path: "agents/training", label: "Mëso nga bisedat", icon: "chat" },
    { id: "agent-process-search", path: "agents/process", label: "Çfarë bën Agjenti", icon: "workflows" },
    { id: "agent-knowledge", path: "knowledge", label: "Njohuritë", icon: "knowledge" },
    { id: "agent-memory", path: "agents/memory", label: "Preferencat dhe shembujt", icon: "history" },
  ] : [];
  const search: WorkspaceLink[] = [...primary, ...items, ...agent, ...inner, ...settings, ...integrations].filter((item, index, all) => all.findIndex(other => other.path === item.path && other.label === item.label) === index);
  const main = ["home", "conversations", "activity", "reports", "customers"].flatMap(id => {
    const item = primary.find(item => item.id === id);
    // Home is the business summary; the assistant opens from the header.
    return item ? [item] : [];
  });
  const management = items.filter(item => !agentIds.has(item.id) && !settingsIds.has(item.id) && !integrationIds.has(item.id) && !ownEntryIds.has(item.id) && !["dashboard", "inbox", "customers"].includes(item.id));
  search.push({ id: "management", path: "business", label: "Menaxhimi", icon: "briefcase" });
  return { primary, main, agent, settings, integrations, business, groups, search, management };
}

/** Manual destinations, grouped by the owner's task; never changes module access. */
export function businessWorkspaceGroups(navigation: ReturnType<typeof organizeWorkspace>) {
  const definitions = [
    { id: "offer", label: "Produkte dhe shërbime", description: "Oferta që u prezanton klientëve.", paths: ["products", "services", "catalogs"] },
    { id: "knowledge", label: "Biznesi dhe oferta", description: "Profili publik i biznesit, oferta dhe informacioni që përdor Agjenti.", paths: ["agents/business", "knowledge", "sources"] },
    { id: "channels", label: "Kanalet", description: "Lidhjet me Instagram dhe WhatsApp.", paths: ["integrations"] },
    { id: "behavior", label: "Agjenti me klientët", description: "Porositë, rezervimet, si komunikon Agjenti dhe ku e provon.", paths: ["agents/orders", "agents/bookings", "agents", "agents/test"] },
    { id: "operations", label: "Porosi dhe rezervime", description: "Puna e përditshme dhe kërkesat e klientëve.", paths: ["orders", "bookings", "leads"] },
  ];
  const links = [...navigation.agent, ...navigation.search];
  return definitions.map(group => ({ ...group, items: group.paths.flatMap(path => {
    const item = links.find(item => item.path === path);
    return item ? [item] : [];
  }) })).filter(group => group.items.length);
}

export function activeWorkspaceLink(pathname: string, base: string, links: WorkspaceLink[]) {
  const under = (path: string) => {
    const href = `${base}${path ? `/${path}` : ""}`;
    return pathname === href || !!path && pathname.startsWith(`${href}/`);
  };
  // The most specific matching path wins, so agents/training belongs to Knowledge, not to agents.
  return links.flatMap(item => [item.path, ...item.also ?? []].filter(under).map(path => ({ item, length: path.length })))
    .sort((a, b) => b.length - a.length)[0]?.item.path;
}

export function workspaceSection(pathname: string, base: string, navigation: ReturnType<typeof organizeWorkspace>): WorkspaceSection | undefined {
  if (pathname === base) return "home";
  for (const id of standaloneIds) {
    if (navigation.primary.some(item => item.id === id) && (pathname === `${base}/${id}` || pathname.startsWith(`${base}/${id}/`))) return id;
  }
  if (navigation.integrations.length && channelPaths.some(path => pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`))) return "integrations";
  if (pathname === `${base}/activity`) return "activity";
  if (pathname === `${base}/reports`) return "reports";
  if (pathname === `${base}/inbox` || pathname.startsWith(`${base}/inbox/`)) return "conversations";
  if (activeWorkspaceLink(pathname, base, navigation.agent) !== undefined) return "agent";
  if (activeWorkspaceLink(pathname, base, navigation.integrations) !== undefined) return "integrations";
  if (activeWorkspaceLink(pathname, base, navigation.settings) !== undefined) return "settings";
  if (activeWorkspaceLink(pathname, base, navigation.business) !== undefined) return "business";
}
