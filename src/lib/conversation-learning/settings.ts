import { createServiceSupabase } from "@/lib/supabase/service";

/** Meta returns details of only the 20 most recent messages of an Instagram conversation. */
export const INSTAGRAM_MESSAGE_LIMIT = 20;

export const learningLimits = {
  min_conversations: { min: 1, max: 500 },
  messages_per_conversation: { min: 1, max: INSTAGRAM_MESSAGE_LIMIT },
  max_conversations: { min: 1, max: 200 },
  lookback_days: { min: 7, max: 365 },
} as const;

export const defaultLearningSettings = {
  enabled: true,
  /** The scan opens only once the business has at least this many conversations. */
  min_conversations: 10,
  /** The most recent messages read from each conversation. */
  messages_per_conversation: 20,
  /** Conversations read in one scan, most recent first. */
  max_conversations: 50,
  /** Only conversations active in this many days. */
  lookback_days: 90,
  /** Also read Instagram DMs from before the account was connected. */
  instagram_history: true,
};
export type LearningSettings = typeof defaultLearningSettings;
type NumberKey = keyof typeof learningLimits;

function whole(value: unknown, key: NumberKey) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return defaultLearningSettings[key];
  const { min, max } = learningLimits[key];
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeLearningSettings(raw: unknown): LearningSettings {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: typeof data.enabled === "boolean" ? data.enabled : defaultLearningSettings.enabled,
    min_conversations: whole(data.min_conversations, "min_conversations"),
    messages_per_conversation: whole(data.messages_per_conversation, "messages_per_conversation"),
    max_conversations: whole(data.max_conversations, "max_conversations"),
    lookback_days: whole(data.lookback_days, "lookback_days"),
    instagram_history: typeof data.instagram_history === "boolean" ? data.instagram_history : defaultLearningSettings.instagram_history,
  };
}

/** The platform's settings; `stored` is false while the migration is not applied (defaults are used). */
export async function loadLearningSettings(): Promise<{ settings: LearningSettings; stored: boolean }> {
  const { data, error } = await createServiceSupabase().from("app_settings").select("conversation_learning").eq("id", true).maybeSingle();
  if (error) {
    if (["42P01", "PGRST205", "42703"].includes(error.code)) return { settings: { ...defaultLearningSettings }, stored: false };
    throw new Error("Cilësimet e mësimit nga bisedat nuk u ngarkuan.");
  }
  return { settings: normalizeLearningSettings(data?.conversation_learning), stored: true };
}
