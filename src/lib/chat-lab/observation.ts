import type { TimedTraceEvent, TraceObserver } from "@/lib/conversations/trace";
import { redactDebug } from "./model";

/** Capture at the executing request, before its encrypted result is committed. */
export function observeLabTurn(enabled: boolean) {
  const started = Date.now();
  const trace: TimedTraceEvent[] = [];
  const onTrace: TraceObserver = event => {
    if (enabled) trace.push({ ...structuredClone(event), elapsedMs: Date.now() - started });
  };
  return { onTrace, finish: () => enabled ? {
    trace: redactDebug(trace) as TimedTraceEvent[], timestamp: new Date().toISOString(),
  } : undefined };
}
