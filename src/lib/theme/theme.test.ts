import { describe, expect, it } from "vitest";
import { readThemePreference, resolveTheme, themeBootScript, THEME_STORAGE_KEY } from "./theme";

function boot(search: string, stored: string | null, systemDark = false) {
  const storage = new Map<string, string>(stored ? [[THEME_STORAGE_KEY, stored]] : []);
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  new Function("localStorage", "location", "matchMedia", "document", themeBootScript)(
    { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    { search },
    () => ({ matches: systemDark }),
    { documentElement: root },
  );
  return { stored: storage.get(THEME_STORAGE_KEY), resolved: root.dataset.resolved };
}

describe("theme boot script", () => {
  it("applies and keeps a theme passed by the native app", () => {
    expect(boot("?theme=dark", "light")).toEqual({ stored: "dark", resolved: "dark" });
    expect(boot("?next=1&theme=light", "dark")).toEqual({ stored: "light", resolved: "light" });
  });

  it("ignores missing or invalid theme parameters", () => {
    expect(boot("", "dark")).toEqual({ stored: "dark", resolved: "dark" });
    expect(boot("?theme=sepia", "dark")).toEqual({ stored: "dark", resolved: "dark" });
  });
});

describe("theme preference", () => {
  it("defaults unknown values to light", () => {
    expect(readThemePreference(null)).toBe("light");
    expect(readThemePreference("sepia")).toBe("light");
    expect(readThemePreference("dark")).toBe("dark");
    expect(readThemePreference("system")).toBe("system");
  });

  it("follows the system only when that mode is selected", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
