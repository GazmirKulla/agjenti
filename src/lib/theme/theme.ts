export const THEME_STORAGE_KEY = "agjenti-theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function readThemePreference(value: string | null): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") return value;
  // Default light so the public landing (always light) and login stay aligned
  // until the user explicitly picks dark or system.
  return "light";
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemDark ? "dark" : "light";
}

export const themeBootScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");if(p!=="light"&&p!=="dark"&&p!=="system")p="light";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;h.dataset.theme=p;h.dataset.resolved=d?"dark":"light";h.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
