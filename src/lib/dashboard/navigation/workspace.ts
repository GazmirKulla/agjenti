import type { NavItem } from "./builder";

export type WorkspaceLink = { id: string; path: string; label: string; icon: string };
export type WorkspaceSection = "home" | "conversations" | "agent" | "activity" | "settings" | "integrations" | "business" | "products" | "services" | "orders" | "leads" | "customers";
const standaloneIds = ["products", "services", "orders", "leads", "customers"] as const;
const agentIds = new Set(["agents", "knowledge", "workflows", "sources"]);
const settingsIds = new Set(["settings", "staff"]);
const integrationIds = new Set(["instagram", "whatsapp"]);

/** Presentation only: keep module permissions, URLs and page implementations intact. */
export function organizeWorkspace(items: NavItem[]) {
  const agent: WorkspaceLink[] = items.filter(item => agentIds.has(item.id)).map(item => ({ ...item, label: item.id === "agents" ? "Identiteti dhe udhëzimet" : item.label }));
  if (items.some(item => item.id === "agents")) agent.push(
    { id: "agent-memory", path: "agents/memory", label: "Memoria", icon: "history" },
    { id: "agent-test", path: "agents/test", label: "Provo agjentin", icon: "spark" },
  );
  const settings: WorkspaceLink[] = items.filter(item => settingsIds.has(item.id)).sort((a, b) => Number(b.id === "settings") - Number(a.id === "settings")).map(item => ({ ...item, label: item.id === "settings" ? "Biznesi dhe modulet" : item.label }));
  settings.push(
    { id: "actions", path: "actions", label: "Aftësitë e biznesit", icon: "spark" },
    { id: "setup", path: "setup", label: "Onboarding", icon: "spark" },
    { id: "billing", path: "billing", label: "Paketa dhe përdorimi", icon: "billing" },
  );
  const integrations: WorkspaceLink[] = items.filter(item => integrationIds.has(item.id));
  const business = items.filter(item => !agentIds.has(item.id) && !settingsIds.has(item.id) && !integrationIds.has(item.id) && !["dashboard", "inbox", ...standaloneIds].includes(item.id));
  const groups = [
    { label: "Oferta", items: business.filter(item => ["products", "services", "catalogs"].includes(item.id)) },
    { label: "Operacionet", items: business.filter(item => ["orders", "bookings", "calendar"].includes(item.id)) },
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
    { id: "activity", section: "activity", path: "activity", label: "Aktiviteti", icon: "history" },
    ...(integrations.length ? [{ id: "integrations", section: "integrations" as const, path: "integrations", label: "Integrimet", icon: "integrations" }] : []),
    { id: "settings", section: "settings", path: "settings", label: "Cilësimet", icon: "settings" },
  ];
  const search = [...primary, ...items, ...agent, ...settings, ...integrations].filter((item, index, all) => all.findIndex(other => other.path === item.path && other.label === item.label) === index);
  const main = ["home", "conversations", "activity", "customers"].flatMap(id => {
    const item = primary.find(item => item.id === id);
    return item ? [{ ...item, label: id === "home" ? "Asistenti AI" : item.label }] : [];
  });
  return { primary, main, agent, settings, integrations, business, groups, search };
}

/** Manual destinations, grouped by the owner's task; never changes module access. */
export function businessWorkspaceGroups(navigation: ReturnType<typeof organizeWorkspace>) {
  const definitions = [
    { id: "offer", label: "Çfarë ofron biznesi", description: "Produktet, shërbimet dhe katalogët që u ofron klientëve.", paths: ["products", "services", "catalogs"] },
    { id: "knowledge", label: "Çfarë di agjenti", description: "Informacioni dhe burimet që përdor për t'u përgjigjur.", paths: ["knowledge", "sources"] },
    { id: "channels", label: "Ku komunikon agjenti", description: "Lidhjet me Instagram dhe WhatsApp.", paths: ["instagram", "whatsapp"] },
    { id: "behavior", label: "Si sillet agjenti", description: "Identiteti, udhëzimet dhe provat e agjentit të klientëve.", paths: ["agents", "agents/memory", "agents/test"] },
    { id: "operations", label: "Puna e përditshme", description: "Porositë, rezervimet dhe kërkesat e klientëve.", paths: ["orders", "bookings", "calendar", "leads"] },
  ];
  const links = [...navigation.agent, ...navigation.search];
  return definitions.map(group => ({ ...group, items: group.paths.flatMap(path => {
    const item = links.find(item => item.path === path);
    return item ? [item] : [];
  }) })).filter(group => group.items.length);
}

export function activeWorkspaceLink(pathname: string, base: string, links: WorkspaceLink[]) {
  return links.filter(item => {
    const href = `${base}${item.path ? `/${item.path}` : ""}`;
    return pathname === href || !!item.path && pathname.startsWith(`${href}/`);
  }).sort((a, b) => b.path.length - a.path.length)[0]?.path;
}

export function workspaceSection(pathname: string, base: string, navigation: ReturnType<typeof organizeWorkspace>): WorkspaceSection | undefined {
  if (pathname === base) return "home";
  for (const id of standaloneIds) {
    if (navigation.primary.some(item => item.id === id) && (pathname === `${base}/${id}` || pathname.startsWith(`${base}/${id}/`))) return id;
  }
  if (navigation.integrations.length && ["integrations", ...integrationIds].some(path => pathname === `${base}/${path}` || pathname.startsWith(`${base}/${path}/`))) return "integrations";
  if (pathname === `${base}/activity`) return "activity";
  if (pathname === `${base}/inbox` || pathname.startsWith(`${base}/inbox/`)) return "conversations";
  if (activeWorkspaceLink(pathname, base, navigation.agent) !== undefined) return "agent";
  if (activeWorkspaceLink(pathname, base, navigation.integrations) !== undefined) return "integrations";
  if (activeWorkspaceLink(pathname, base, navigation.settings) !== undefined) return "settings";
  if (activeWorkspaceLink(pathname, base, navigation.business) !== undefined) return "business";
}
