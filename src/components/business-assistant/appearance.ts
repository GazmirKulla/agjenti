import { defaultPersonalAssistantName, readPersonalAssistantName } from "@/lib/business-assistant/identity";

export const assistantAvatars = [
  { id: "blue", label: "Blu" },
  { id: "mint", label: "Mente" },
  { id: "lilac", label: "Jargavan" },
] as const;

export type AssistantAppearance = {
  name: string;
  avatar: (typeof assistantAvatars)[number]["id"];
};
export const defaultAppearance: AssistantAppearance = { name: defaultPersonalAssistantName, avatar: "blue" };
export const appearanceStorageKey = (userId: string, slug: string) =>
  `agjenti:personal-assistant:v1:${encodeURIComponent(userId)}:${encodeURIComponent(slug)}`;

export function parseAppearance(raw: string | null): AssistantAppearance {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return defaultAppearance;
    const { name, avatar } = value as Record<string, unknown>;
    return {
      name: readPersonalAssistantName(typeof name === "string" ? name.trim().slice(0, 32) : name) ?? defaultAppearance.name,
      avatar: assistantAvatars.some(item => item.id === avatar) ? avatar as AssistantAppearance["avatar"] : defaultAppearance.avatar,
    };
  } catch { return defaultAppearance; }
}

/** Presentation only: activity belongs to the existing conversation, not storage. */
export function assistantActivity(online: boolean, busy: boolean, awaitingApproval: boolean) {
  if (!online) return { kind: "offline", label: "Pa lidhje" } as const;
  if (busy) return { kind: "working", label: "Po punon…" } as const;
  if (awaitingApproval) return { kind: "approval", label: "Pret konfirmimin tënd" } as const;
  return { kind: "available", label: "Gati për të ndihmuar" } as const;
}
