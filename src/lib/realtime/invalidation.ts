/** Payloads are hints, never business data or permission to perform a write. */
export const resources = ["inbox", "transport", "reactions", "assistant", "discovery", "training", "campaigns", "business", "access"] as const;
export type Resource = typeof resources[number];
export type Change = { resource: Resource; slug?: string };
export function parseChange(value: unknown): Change | null {
  if (!value || typeof value !== "object") return null;
  const resource = (value as Record<string, unknown>).resource;
  if (typeof resource !== "string" || !(resources as readonly string[]).includes(resource)) return null;
  const slug = (value as Record<string, unknown>).slug;
  if (slug !== undefined && (typeof slug !== "string" || !slug.length || slug.length > 200)) return null;
  return { resource: resource as Resource, ...(typeof slug === "string" ? { slug } : {}) };
}

/** Scope only controls refreshing; the API remains the authorization boundary. */
export function matchesChange(change: Change | null, wanted: readonly Resource[], slug?: string) {
  return change === null || change.resource === "access"
    || (wanted.includes(change.resource) && (!slug || !change.slug || change.slug === slug));
}

/** Coalesce bursts; an event received during a read always gets a trailing read.
 * No retries or periodic reads: reconnect and user actions explicitly invalidate.
 */
export function invalidationTask(read: () => void | Promise<void>, visible: () => boolean, delay = 100) {
  let stopped = false, running = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    timer = undefined;
    if (stopped || running || !dirty || !visible()) return;
    dirty = false; running = true;
    try { await read(); } catch { /* The reader owns its error UI; reconnect/manual refresh can retry. */ }
    finally { running = false; if (dirty && !stopped && visible()) schedule(); }
  };
  const schedule = () => { if (!timer && !running && !stopped && visible()) timer = setTimeout(() => void flush(), delay); };
  return {
    invalidate() { dirty = true; schedule(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); },
  };
}
