/** Internal, opt-in observability. Never serialize a trace outside an authorized admin boundary. */
export type TraceStage = "overview" | "context" | "workflow" | "ai" | "tools" | "logs";
export type TraceEvent = {
  stage: TraceStage;
  label: string;
  data?: Record<string, unknown>;
  status?: "success" | "error" | "skipped";
};
export type TraceObserver = (event: TraceEvent) => void;
export type TimedTraceEvent = TraceEvent & { elapsedMs: number };
