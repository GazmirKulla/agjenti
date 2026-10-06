export const MODULE_IDS = [
  "dashboard",
  "inbox",
  "products",
  "services",
  "orders",
  "bookings",
  "calendar",
  "staff",
  "catalogs",
  "leads",
  "customers",
  "agents",
  "knowledge",
  "workflows",
  "instagram",
  "settings",
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export type ModuleDefinition = {
  id: ModuleId;
  path: string;
  label: string;
  icon: string;
  /** Always present in workspace chrome; not toggled in Settings. */
  core?: boolean;
  /** Prefer in mobile bottom nav when enabled. */
  mobilePriority?: number;
  description: string;
};

export type ModuleDependencyRule = {
  requires?: ModuleId[];
  requiresAny?: ModuleId[];
  optionalFor?: ModuleId[];
  independent?: boolean;
};

export type DashboardSignals = {
  businessType: string;
  offeringTypes: string[];
  selectedUseCases: string[];
  agentCapabilities: string[];
  workflow?: string;
  teamSize?: string;
};

export type PrimaryAction = {
  id: string;
  label: string;
  href: string;
  icon: string;
};

export type DashboardWidget = {
  id: string;
  label: string;
  hint: string;
  icon: string;
  tone?: "default" | "blue" | "pink";
  /** Which stats field to bind, when available. */
  stat?: "conversations" | "orders" | "customers" | "connections" | "agents" | "paused";
};

export type DashboardProfile = {
  version: 1;
  source: "generated" | "manual" | "legacy";
  enabledModules: ModuleId[];
  navigationItems: ModuleId[];
  mobileNavigationItems: ModuleId[];
  widgets: DashboardWidget[];
  primaryActions: PrimaryAction[];
  signals?: DashboardSignals;
};
