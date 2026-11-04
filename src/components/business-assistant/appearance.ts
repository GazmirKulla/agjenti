/** Retire browser-only customization without touching conversations or other preferences. */
export function clearLegacyAssistantAppearance() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith("agjenti:personal-assistant:v1:")) localStorage.removeItem(key);
    }
  } catch {
    // Storage may be disabled. The assistant still uses its fixed identity.
  }
}
