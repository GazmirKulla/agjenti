/** Public sector choices. Historical identifiers remain valid for saved profiles. */
export const businessCategories = [
  ["retail", "Dyqan / Tregti", "store"],
  ["beauty", "Bukuri / Kujdes", "scissors"],
  ["healthcare", "Shëndetësi / Klinikë", "medical"],
  ["food", "Restorant / Bar", "food"],
  ["hospitality", "Hotel / Akomodim", "hotel"],
  ["fitness", "Sport / Fitness", "fitness"],
  ["education", "Arsim / Kurse", "knowledge"],
  ["professional", "Shërbime profesionale", "briefcase"],
  ["digital", "Teknologji / Shërbime digjitale", "display"],
  ["technical", "Riparime / Shërbime teknike", "wrench"],
  ["realestate", "Pasuri të paluajtshme", "home"],
  ["manufacturing", "Prodhim / Distribucion", "factory"],
  ["other", "Tjetër", "businesses"],
] as const;

export const legacyBusinessCategories = [
  ["ecommerce", "Dyqan online", "store"],
  ["personalized", "Produkte të personalizuara", "spark"],
  ["fashion", "Veshje dhe modë", "scissors"],
  ["electronics", "Elektronikë", "settings"],
  ["services", "Shërbime", "briefcase"],
] as const;

export const supportedBusinessCategories = [...businessCategories, ...legacyBusinessCategories];
export type BusinessType = (typeof supportedBusinessCategories)[number][0];
