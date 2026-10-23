import type { Fact } from "./context";
import { foldText, type ConversationStatePayload } from "./engine";

/** Conversation-local only. Never hydrate from / copy to conversation_profiles,
 * never use as business configuration, entity identity or execution permission. */
export const customerDeclaredKeys = ["instagram_handle", "business_type", "stated_needs"] as const;
export type CustomerDeclaredKey = typeof customerDeclaredKeys[number];
export type CustomerDeclaredFacts = Partial<Record<CustomerDeclaredKey, Fact>>;

export function validDeclaredValue(key: CustomerDeclaredKey, value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\n\r\x00-\x1f]/.test(value)) return false;
  return key !== "instagram_handle" || /^@?[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?$/.test(value);
}

/** Explicit own statements only, not free-form summaries or LLM-inferred facts.
 * Commas are retained in stated needs; newline/semicolon delimit statements. */
export function extractCustomerDeclaredFacts(state: ConversationStatePayload, message: string) {
  if (state.staffHandoff || state.visual?.status === "handoff") return 0;
  let count = 0;
  for (const part of message.split(/[;\n]/)) {
    const raw = part.trim();
    if (raw.includes("?")) continue;
    const label = raw.match(/^([^:]{1,70}):\s*(.+)$/);
    let key: CustomerDeclaredKey | undefined, value: string | undefined;
    if (label) {
      const name = foldText(label[1]);
      if (/^(instagram|instagram profile|profili (?:im )?ne instagram)$/.test(name)) key = "instagram_handle";
      if (/^(business type|lloji i biznesit|biznesi im)$/.test(name)) key = "business_type";
      if (/^(common questions|pyetjet (?:tipike|e zakonshme)|nevojat e mia)$/.test(name)) key = "stated_needs";
      value = label[2].trim();
    } else {
      // Preserve the original value; folding is used only to recognize the label.
      const statement = raw.match(/^(profili im n[eë] instagram|instagrami im|biznesi im|lloji i biznesit tim|pyetjet q[eë] marr m[eë] shpesh|nevojat e mia)\s+(?:[eë]sht[eë]|jan[eë])\s+(.+)$/i);
      if (statement) {
        const prefix = foldText(statement[1]);
        key = prefix.includes("instagram") ? "instagram_handle" : prefix.includes("biznes") ? "business_type" : "stated_needs";
        value = statement[2].trim();
      }
    }
    if (!key || !value || !validDeclaredValue(key, value)) continue;
    state.customerDeclaredFacts ??= {};
    state.customerDeclaredFacts[key] = { value, type: "text", source: "customer_declaration", validated: true };
    count++;
  }
  return count;
}
