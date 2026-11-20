/** A controlled error names its own code (`failure`): the Assistant's refusals, operation checks, persistence checks. */
const ownCode = (error: unknown) => {
  const code = error && typeof error === "object" ? (error as { failure?: unknown }).failure : undefined;
  return typeof code === "string" && /^[a-z_]{2,40}$/.test(code) ? code : null;
};

/**
 * The code a failure is recorded with, from the kind of error the server raised (never from its text):
 * a refusal of the Assistant, a controlled check with its own code, or "unexpected" for anything the code
 * did not anticipate, which is a bug to look at.
 */
export function failureCode(error: unknown): string {
  const own = ownCode(error);
  if (own) return own;
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
    // A provider SDK error (OpenAI and others) carries its HTTP status.
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 600) return `provider_${status}`;
    // Our own internal errors are plain Errors thrown with a code as their message ("checkpoint_failed", "lease_expired").
    if (error.constructor === Error && /^[a-z]+(_[a-z0-9]+)+$/.test(error.message) && error.message.length <= 60) return error.message;
  }
  return "unexpected";
}

/** An unexpected failure goes to the server log with where it happened, so it can be found and fixed. */
export function logUnexpected(where: string, capability: string, ref: string, error: unknown) {
  const code = failureCode(error);
  if (code !== "unexpected" && code !== "timeout" && !code.startsWith("provider_5")) return;
  const e = error instanceof Error ? error : new Error(String(error));
  console.error("capability_unexpected_failure", JSON.stringify({ where, capability, ref, name: e.name, message: e.message.slice(0, 300),
    stack: e.stack?.split("\n").slice(1, 6).map(line => line.trim()) }));
}
