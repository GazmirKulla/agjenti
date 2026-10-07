import type { AgentTurnResult } from "@/lib/conversations/process-agent-turn";
import type { TimedTraceEvent } from "@/lib/conversations/trace";
import type { ConversationStatePayload, WorkflowStepDef } from "@/lib/workflows/engine";

export type LabBusiness = { id: string; name: string; slug: string };
export type LabSetup = LabBusiness & {
  businessType: string; products: number; services: number; workflows: number;
  channels: { username: string | null; status: string }[];
};
export type LabField = { key: string; value: unknown; status: "completed" | "missing" | "optional" };
export type LabTurn = AgentTurnResult & {
  testConversationId: string; session: string; replaySession: string; turns: number;
  trace: TimedTraceEvent[]; timestamp: string; input: string;
  fields: LabField[]; warnings: string[];
};
export type LabFailure = { error: string; trace?: TimedTraceEvent[] };
export type LabResult = LabFailure | LabTurn;

export function workflowFields(state: ConversationStatePayload, steps: WorkflowStepDef[]): LabField[] {
  const fields: LabField[] = [];
  const add = (key: string, value: unknown, required: boolean) => {
    const present = value !== null && value !== undefined && value !== "";
    fields.push({ key, value: value ?? null, status: present ? "completed" : required ? "missing" : "optional" });
  };
  if (state.fields.catalog_context && typeof state.fields.catalog_context === "object") {
    const context = state.fields.catalog_context as { pending?: string; requirements?: Record<string, unknown> };
    for (const [key, value] of Object.entries(context.requirements ?? {})) add(key, value, true);
    if (context.pending && !fields.some((f) => f.key === context.pending)) add(context.pending, null, true);
  }
  for (const step of steps) {
    if (step.kind === "customer") {
      for (const [key, value] of Object.entries(state.customer)) add(key, value, step.required !== false);
    } else add(step.key, state.fields[step.key] ?? (step.kind === "photo" ? state.fields.photo : null), step.required !== false);
  }
  return fields;
}

/** Defense in depth: redact credentials in both structured data and free text. */
export function redactDebug(value: unknown): unknown {
  if (typeof value === "string") {
    let result = value.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(/([?&](?:access_token|api_key|secret|token)=)[^&\s]+/gi, "$1[REDACTED]");
    for (const key of ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TOKEN_ENCRYPTION_KEY", "META_APP_SECRET"]) {
      const secret = process.env[key];
      if (secret && secret.length >= 8) result = result.split(secret).join("[REDACTED]");
    }
    return result;
  }
  if (Array.isArray(value)) return value.map(redactDebug);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, /authorization|api[_-]?key|secret|password|ciphertext|access[_-]?token|refresh[_-]?token/i.test(key) ? "[REDACTED]" : redactDebug(item)]),
  );
  return value;
}
