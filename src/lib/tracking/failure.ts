import { OperationError } from "@/lib/actions/operations/error";
import { AssistantError } from "@/lib/business-assistant/model";
import { PersistenceError } from "@/lib/business-assistant/persistence";

const byStatus: Record<number, string> = { 400: "invalid_input", 403: "unauthorized", 404: "not_found", 409: "stale", 429: "limit", 503: "unavailable" };

/**
 * The code a failure is recorded with, from the kind of error the server raised (never from its text):
 * a refusal of the Assistant, a controlled check with its own code, or "unexpected" for anything the code
 * did not anticipate, which is a bug to look at.
 */
export function failureCode(error: unknown): string {
  if (error instanceof AssistantError) return "assistant_refusal";
  if (error instanceof OperationError) return error.code;
  if (error instanceof PersistenceError) return byStatus[error.status] ?? "check_failed";
  return "unexpected";
}

/** An unexpected failure goes to the server log with where it happened, so it can be found and fixed. */
export function logUnexpected(where: string, capability: string, ref: string, error: unknown) {
  if (failureCode(error) !== "unexpected") return;
  const e = error instanceof Error ? error : new Error(String(error));
  console.error("capability_unexpected_failure", JSON.stringify({ where, capability, ref, name: e.name, message: e.message.slice(0, 300),
    stack: e.stack?.split("\n").slice(1, 6).map(line => line.trim()) }));
}
