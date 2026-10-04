"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import {
  THEME_STORAGE_KEY,
  readThemePreference,
  resolveTheme,
  type ThemePreference,
} from "@/lib/theme/theme";

const options: { value: ThemePreference; label: string; icon: string }[] = [
  { value: "light", label: "Çelët", icon: "sun" },
  { value: "system", label: "Sistemi", icon: "display" },
  { value: "dark", label: "Errët", icon: "moon" },
];

export function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  document.documentElement.dataset.theme = preference;
  document.documentElement.dataset.resolved = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeSwitch() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = readThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
    setPreference(stored);
    applyTheme(stored);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = readThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
      if (current === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function choose(next: ThemePreference) {
    setPreference(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  }

  return (
    <div className="theme-switch" role="radiogroup" aria-label="Pamja">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          aria-label={option.label}
          title={option.label}
          className={preference === option.value ? "is-active" : ""}
          onClick={() => choose(option.value)}
        >
          <Icon name={option.icon} size={15} />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
