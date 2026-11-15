/** What the import page tells about a running import: which step, and the time left of it. */
type Progress = { done?: number; total?: number; open?: boolean; stageStartedAt?: string };

const STEPS = ["count", "ingest", "history", "style", "extract", "consolidate", "match"];

/** "Hapi 2 nga 6": counting and reading are one step for the owner; an export has no
 * Instagram history step; a retry of adding to Conversations has no steps to show. */
export function stepOf(s: { stage: string; source: string; historyOnly?: boolean | null }) {
  if (s.historyOnly) return "";
  const steps = (s.source === "inbox" ? STEPS : STEPS.filter((x) => x !== "history")).slice(1);
  const index = steps.indexOf(s.stage === "count" ? "ingest" : s.stage);
  return index < 0 ? "" : `Hapi ${index + 1} nga ${steps.length}`;
}

/** Time left of the current step, from its pace so far; nothing until it can be told. */
export function timeLeft(progress: Progress, now = Date.now()) {
  const { done = 0, total = 0, stageStartedAt, open } = progress;
  if (open || !stageStartedAt || done <= 0 || total <= done) return "";
  const elapsed = now - Date.parse(stageStartedAt);
  if (!Number.isFinite(elapsed) || elapsed <= 0) return "";
  const minutes = Math.ceil(((elapsed / done) * (total - done)) / 60_000);
  return minutes <= 1 ? "rreth 1 minutë për këtë hap" : `rreth ${minutes} minuta për këtë hap`;
}
