/** Routed destinations only; permissions remain enforced by server loaders/actions. */
export const settingsGroups = [
  { label: "Personale", items: [{ path: "profile", label: "Profili" }, { path: "preferences", label: "Preferencat" }] },
  { label: "Biznesi", items: [{ path: "business", label: "Profili i biznesit" }, { path: "billing", label: "Paketa dhe përdorimi" }] },
  { label: "Migo AI", items: [{ path: "migo", label: "Asistenti yt" }] },
  { label: "Avancuar", items: [{ path: "modules", label: "Modulet" }, { path: "actions", label: "Aftësitë e biznesit" }, { path: "advanced", label: "Mjete të avancuara" }] },
] as const;
