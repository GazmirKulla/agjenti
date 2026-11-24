import { isOperationKey, operationCatalog } from "./catalog";

type ActivityStep = { requestId: string; title: string; subject?: string };
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

// Presentation only: this projection must never authorize or execute a step.
export function readActivitySteps(value: unknown): { version: 1 | 2; steps: ActivityStep[] } | null {
  if (!Array.isArray(value) || !value.length) return null;
  const version = record(value[0])?.version;
  if (version !== 1 && version !== 2) return null;
  const steps: ActivityStep[] = [];
  for (const raw of value) {
    const step = record(raw);
    if (!step || step.version !== version || typeof step.requestId !== "string" || !step.requestId) return null;
    const preview = record(version === 1 ? step.preview : record(step.prepared)?.preview);
    const key = record(step.definition)?.key;
    const title = typeof preview?.title === "string" ? preview.title
      : version === 2 && isOperationKey(key) ? operationCatalog[key].title : null;
    if (!title) return null;
    // A dependent step is prepared only when it runs; until then its own
    // definition still names what it is about (e.g. the knowledge title).
    const planned = version === 2 ? record(record(step.definition)?.input)?.title : undefined;
    const subject = typeof preview?.subject === "string" ? preview.subject
      : typeof planned === "string" && planned.trim() ? planned.trim() : undefined;
    steps.push({ requestId: step.requestId, title, subject });
  }
  return { version, steps };
}
