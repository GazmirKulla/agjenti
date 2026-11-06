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

// The native app opens web views with ?theme=light|dark; it is stored so later navigations keep it.
export const themeBootScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");if(q==="light"||q==="dark"||q==="system")localStorage.setItem("${THEME_STORAGE_KEY}",q);var p=localStorage.getItem("${THEME_STORAGE_KEY}");if(p!=="light"&&p!=="dark"&&p!=="system")p="light";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;h.dataset.theme=p;h.dataset.resolved=d?"dark":"light";h.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
