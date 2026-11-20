/**
 * Why a controlled check stopped a change, as a code: the input was not valid, the data changed meanwhile,
 * no access, the record is gone, a limit was reached, a service was unavailable, or another check failed.
 */
export type FailureCode = "invalid_input" | "stale" | "unauthorized" | "not_found" | "limit" | "unavailable" | "check_failed";

/** An actionable, public message; infrastructure errors stay private. */
export class OperationError extends Error {
  constructor(message: string, public code: FailureCode = "check_failed") { super(message); }
  /** The code Shëndeti i Agjentit records for this failure. */
  get failure() { return this.code; }
}
