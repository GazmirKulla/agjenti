import { english } from "./messages";

export type DashboardLanguage = "sq" | "en";
export const LANGUAGE_COOKIE = "agjenti_dashboard_language";
export function dashboardLanguage(value: unknown): DashboardLanguage {
  return value === "en" ? "en" : "sq";
}
/** Translate interface copy only, never customer messages or business data. */
export function translator(language: DashboardLanguage) {
  return (text: string): string => language === "en" && Object.hasOwn(english, text) ? english[text] : text;
}
