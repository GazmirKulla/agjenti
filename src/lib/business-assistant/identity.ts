export const defaultPersonalAssistantName = "Asistenti AI";

/** A display preference only. It must never supply tenant identity or permissions. */
export function readPersonalAssistantName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > 32 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  return name;
}
