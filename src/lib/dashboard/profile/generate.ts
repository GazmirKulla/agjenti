import { moduleRegistry, navigationOrder } from "../modules/registry";
import { normalizeEnabledModules } from "../modules/dependencies";
import type {
  DashboardProfile,
  DashboardSignals,
  DashboardWidget,
  ModuleId,
  PrimaryAction,
} from "../modules/types";

const PRODUCT_OFFERINGS = new Set([
  "standard",
  "variants",
  "personalized",
  "photo",
  "text",
  "mixed",
]);

function hasProducts(offerings: readonly string[]) {
  return offerings.some((item) => PRODUCT_OFFERINGS.has(item));
}

function hasServices(offerings: readonly string[]) {
  return offerings.some((item) => item === "services" || item === "mixed");
}

function includesAny(values: readonly string[], candidates: readonly string[]) {
  return candidates.some((item) => values.includes(item));
}

function inferModules(signals: DashboardSignals): ModuleId[] {
  const {
    businessType,
    offeringTypes,
    selectedUseCases: useCases,
    agentCapabilities: caps,
    workflow = "",
  } = signals;

  const products = hasProducts(offeringTypes);
  const services = hasServices(offeringTypes);
  const bookingFlow =
    includesAny(useCases, ["booking"]) ||
    caps.includes("handle_bookings") ||
    /appointment|booking|service-request|service-or-product/i.test(workflow);
  const leadFlow =
    includesAny(useCases, ["leads"]) ||
    caps.includes("qualify_leads") ||
    /quote|lead|demo/i.test(workflow);
  const orderFlow =
    includesAny(useCases, ["orders", "collection"]) ||
    includesAny(caps, ["create_order", "collect_order_details"]) ||
    /product-order|variant-order|personalized-order/i.test(workflow);
  const catalogFlow =
    (!products && leadFlow && !bookingFlow) ||
    /catalog/i.test(workflow) ||
    businessType === "other" && leadFlow && !products;

  const enabled = new Set<ModuleId>([
    "dashboard",
    "inbox",
    "agents",
    "sources",
    "instagram",
    "settings",
    "customers",
  ]);

  if (
    products &&
    (includesAny(useCases, [
      "products",
      "sales",
      "orders",
      "recommendations",
      "collection",
    ]) ||
      includesAny(caps, [
        "recommend_products",
        "compare_products",
        "answer_product_details",
        "create_order",
        "collect_order_details",
      ]) ||
      orderFlow)
  ) {
    enabled.add("products");
  }

  if (products && orderFlow) enabled.add("orders");

  if (services || bookingFlow) enabled.add("services");
  if (bookingFlow) {
    enabled.add("bookings");
    enabled.add("calendar");
  }


  if (catalogFlow) {
    enabled.add("catalogs");
    enabled.add("leads");
  } else if (leadFlow) {
    enabled.add("leads");
    if (!products && !services) enabled.add("catalogs");
  }

  if (
    includesAny(useCases, ["support", "messages"]) ||
    services ||
    catalogFlow ||
    caps.includes("answer_questions")
  ) {
    enabled.add("knowledge");
  }

  if (
    products ||
    caps.includes("follow_workflow") ||
    includesAny(useCases, ["collection", "orders"])
  ) {
    enabled.add("workflows");
  }

  // Beauty / hybrid defaults: keep both sides when mixed.
  if (offeringTypes.includes("mixed")) {
    enabled.add("products");
    enabled.add("services");
    if (bookingFlow) {
      enabled.add("bookings");
      enabled.add("calendar");
    }
    if (orderFlow) enabled.add("orders");
  }

  return normalizeEnabledModules([...enabled]);
}

function resolveWidgets(
  enabled: ReadonlySet<ModuleId>,
  signals: DashboardSignals,
): DashboardWidget[] {
  if (enabled.has("bookings") || enabled.has("calendar")) {
    return [
      {
        id: "bookings_today",
        label: "Rezervime sot",
        hint: "Rezervimet e ditës",
        icon: "orders",
        stat: "orders",
      },
      {
        id: "upcoming",
        label: "Në pritje",
        hint: "Takime të ardhshme",
        icon: "calendar",
        stat: "conversations",
      },
      {
        id: "new_customers",
        label: "Klientë të rinj",
        hint: "Të regjistruar",
        icon: "customers",
        tone: "blue",
        stat: "customers",
      },
      {
        id: "popular_service",
        label: "Biseda aktive",
        hint: "Mesazhe në rrjedhë",
        icon: "inbox",
        tone: "pink",
        stat: "conversations",
      },
    ];
  }

  if (enabled.has("catalogs") || (enabled.has("leads") && !enabled.has("products"))) {
    return [
      {
        id: "new_leads",
        label: "Lead të reja",
        hint: "Kërkesa të hapura",
        icon: "customers",
        stat: "customers",
      },
      {
        id: "catalog_requests",
        label: "Biseda",
        hint: "Biseda me interes",
        icon: "inbox",
        stat: "conversations",
      },
      {
        id: "qualified",
        label: "Të kualifikuara",
        hint: "Lead të përpunuara",
        icon: "spark",
        tone: "blue",
        stat: "agents",
      },
      {
        id: "handoffs",
        label: "Handoff",
        hint: "Biseda të pauzuara",
        icon: "businesses",
        tone: "pink",
        stat: "paused",
      },
    ];
  }

  if (enabled.has("orders") || enabled.has("products")) {
    return [
      {
        id: "orders_today",
        label: "Porosi",
        hint: "Të gjitha statuset",
        icon: "orders",
        stat: "orders",
      },
      {
        id: "conversations",
        label: "Biseda",
        hint: "Gjithsej në platformë",
        icon: "inbox",
        stat: "conversations",
      },
      {
        id: "new_customers",
        label: "Klientë",
        hint: "Klientë të regjistruar",
        icon: "customers",
        tone: "blue",
        stat: "customers",
      },
      {
        id: "instagram",
        label: "Instagram i lidhur",
        hint: "Llogari me status të lidhur",
        icon: "instagram",
        tone: "pink",
        stat: "connections",
      },
    ];
  }

  // Lead / messaging default for service request without calendar.
  if (enabled.has("leads") || signals.selectedUseCases.includes("leads")) {
    return [
      {
        id: "new_leads",
        label: "Lead të reja",
        hint: "Kërkesa të hapura",
        icon: "customers",
        stat: "customers",
      },
      {
        id: "conversations",
        label: "Biseda",
        hint: "Mesazhe në rrjedhë",
        icon: "inbox",
        stat: "conversations",
      },
      {
        id: "qualified",
        label: "Të kualifikuara",
        hint: "Lead të përpunuara",
        icon: "spark",
        tone: "blue",
        stat: "agents",
      },
      {
        id: "handoffs",
        label: "Handoff",
        hint: "Biseda të pauzuara",
        icon: "businesses",
        tone: "pink",
        stat: "paused",
      },
    ];
  }

  return [
    {
      id: "conversations",
      label: "Biseda",
      hint: "Gjithsej në platformë",
      icon: "inbox",
      stat: "conversations",
    },
    {
      id: "customers",
      label: "Klientë",
      hint: "Klientë të regjistruar",
      icon: "customers",
      tone: "blue",
      stat: "customers",
    },
    {
      id: "agents",
      label: "Agjentë aktivë",
      hint: "Konfigurimi i agjentit",
      icon: "agents",
      stat: "agents",
    },
    {
      id: "instagram",
      label: "Instagram i lidhur",
      hint: "Llogari me status të lidhur",
      icon: "instagram",
      tone: "pink",
      stat: "connections",
    },
  ];
}

function resolvePrimaryActions(
  enabled: ReadonlySet<ModuleId>,
): PrimaryAction[] {
  const actions: PrimaryAction[] = [];
  if (enabled.has("products")) {
    actions.push({
      id: "add_product",
      label: "Shto produkt",
      href: "products",
      icon: "products",
    });
  }
  if (enabled.has("bookings")) {
    actions.push({
      id: "new_booking",
      label: "Rezervim i ri",
      href: "bookings",
      icon: "orders",
    });
  } else if (enabled.has("services")) {
    actions.push({
      id: "add_service",
      label: "Shto shërbim",
      href: "services",
      icon: "knowledge",
    });
  }
  if (enabled.has("catalogs")) {
    actions.push({
      id: "add_catalog",
      label: "Shto katalog",
      href: "catalogs",
      icon: "knowledge",
    });
  }
  if (enabled.has("leads") && !enabled.has("bookings")) {
    actions.push({
      id: "new_lead",
      label: "Lead / kërkesë",
      href: "leads",
      icon: "customers",
    });
  }
  if (!actions.length) {
    actions.push({
      id: "open_inbox",
      label: "Shiko mesazhet",
      href: "inbox",
      icon: "inbox",
    });
  }
  return actions.slice(0, 4);
}

function buildNavigation(enabled: readonly ModuleId[]): ModuleId[] {
  return navigationOrder.filter((id) => enabled.includes(id));
}

function buildMobileNavigation(enabled: readonly ModuleId[]): ModuleId[] {
  const ranked = enabled
    .map((id) => moduleRegistry[id])
    .filter((mod) => typeof mod.mobilePriority === "number")
    .sort(
      (a, b) => (a.mobilePriority ?? 99) - (b.mobilePriority ?? 99) || 0,
    );
  const picked: ModuleId[] = [];
  for (const mod of ranked) {
    if (picked.length >= 4) break;
    if (!picked.includes(mod.id)) picked.push(mod.id);
  }
  // Ensure dashboard is first when present.
  if (picked.includes("dashboard") && picked[0] !== "dashboard") {
    const ordered: ModuleId[] = [
      "dashboard",
      ...picked.filter((id) => id !== "dashboard"),
    ];
    return ordered.slice(0, 4);
  }
  return picked.slice(0, 4);
}

export function generateDashboardProfile(
  signals: DashboardSignals,
  source: "generated" | "manual" = "generated",
): DashboardProfile {
  const enabledModules = inferModules(signals);
  const enabled = new Set(enabledModules);
  return {
    version: 1,
    source,
    enabledModules,
    navigationItems: buildNavigation(enabledModules),
    mobileNavigationItems: buildMobileNavigation(enabledModules),
    widgets: resolveWidgets(enabled, signals),
    primaryActions: resolvePrimaryActions(enabled),
    signals,
  };
}

export function rebuildProfileFromModules(
  enabledModules: readonly ModuleId[],
  signals?: DashboardSignals,
): DashboardProfile {
  const normalized = normalizeEnabledModules(enabledModules);
  const enabled = new Set(normalized);
  const fallbackSignals: DashboardSignals = signals ?? {
    businessType: "other",
    offeringTypes: [],
    selectedUseCases: [],
    agentCapabilities: [],
  };
  return {
    version: 1,
    source: "manual",
    enabledModules: normalized,
    navigationItems: buildNavigation(normalized),
    mobileNavigationItems: buildMobileNavigation(normalized),
    widgets: resolveWidgets(enabled, fallbackSignals),
    primaryActions: resolvePrimaryActions(enabled),
    signals: fallbackSignals,
  };
}
