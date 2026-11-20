import { scheduledJobCapability } from "./scheduled-jobs";
import { failureCode, logUnexpected } from "./failure";

/**
 * Platform work the agents depend on: background jobs and integrations. Each records how it ended, with a
 * code from the kind of error (and the step it was in), so a failure shows in Shëndeti i Agjentit instead of
 * only in a server log. Recording never changes the outcome of the work.
 */
export async function recordSystem(capability: string, point: string, options: { businessId?: string | null; reason?: string; ref?: string; durationMs?: number } = {}) {
  // Loaded when used: integrations and jobs import this module, and the capability list imports much of the app.
  const { recordCapabilityEvents } = await import("./events");
  await recordCapabilityEvents([{ businessId: options.businessId ?? null, capability, point, reason: options.reason, mode: "live", ref: options.ref, durationMs: options.durationMs }]);
}

/** The code of a failure in a step: "capture:timeout". Unexpected errors also go to the server log. */
export function stepFailure(capability: string, step: string, error: unknown, ref?: string) {
  logUnexpected(step, capability, ref ?? "", error);
  return `${step}:${failureCode(error)}`.slice(0, 80);
}

/** A background job step of one business that failed. */
export async function recordStepFailed(capability: string, businessId: string, step: string, error: unknown, ref?: string) {
  await recordSystem(capability, "step_failed", { businessId, reason: stepFailure(capability, step, error, ref), ref });
}

/** A background job of one business that finished. */
export async function recordCompleted(capability: string, businessId: string, ref?: string) {
  await recordSystem(capability, "completed", { businessId, ref });
}

const SUCCESS_EVERY_MS = 3600000;

/** One scheduled run (a folder of src/app/api/cron): how it ended, then its own response. */
export async function trackScheduledJob(job: string, work: () => Promise<Response>): Promise<Response> {
  const capability = scheduledJobCapability(job), started = Date.now();
  try {
    const response = await work();
    // A call without the scheduler's secret is not a run.
    if (response.status === 401) return response;
    const ok = response.ok || response.status === 202;
    // Some runs come every minute: every failure is kept, a success at most once an hour per job.
    if (ok) {
      const { lastRecordedAt } = await import("./events");
      const last = await lastRecordedAt(capability, "completed");
      if (last && Date.now() - Date.parse(last) < SUCCESS_EVERY_MS) return response;
    }
    await recordSystem(capability, ok ? "completed" : "failed", { reason: ok ? undefined : `http_${response.status}`, ref: job, durationMs: Date.now() - started });
    return response;
  } catch (error) {
    await recordSystem(capability, "failed", { reason: stepFailure(capability, "run", error, job), ref: job, durationMs: Date.now() - started });
    throw error;
  }
}

/** A Meta (Instagram, WhatsApp) error as a code: "meta_100_33". Never its text. */
export function metaCode(error: { code?: unknown; error_subcode?: unknown } | null | undefined) {
  const code = Number(error?.code), sub = Number(error?.error_subcode);
  return Number.isFinite(code) && code > 0 ? `meta_${code}${Number.isFinite(sub) && sub > 0 ? `_${sub}` : ""}` : "meta_unknown";
}
