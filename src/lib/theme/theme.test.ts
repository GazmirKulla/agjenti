import { describe, expect, it } from "vitest";
import { readThemePreference, resolveTheme } from "./theme";

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
