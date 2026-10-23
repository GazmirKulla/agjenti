import { AsyncLocalStorage } from "node:async_hooks";
import type { CollectionPin } from "./collection-policy";

/** Server-owned execution kind. Never read from model output or workflow configuration. */
export type ExecutionKind = "live" | "isolated";
export type ExternalActionDisposition = "SIMULATED" | "UNVERIFIED" | "BLOCKED" | "UNSUPPORTED";
export type ExternalActionKind =
  | "booking.availability"
  | "booking.create"
  | "order.create"
  | "payment.process"
  | "staff.handoff"
  | "provider.http"
  | "provider.token_refresh"
  | "customer.message"
  | "webhook"
  | "background_job"
  | "database.mutate"
  | "action.provision";

export type ExternalAction = {
  kind: ExternalActionKind;
  disposition: ExternalActionDisposition;
  detail?: string;
};

export type IsolatedCalendarPort = {
  availableSlots: (
    businessId: string,
    serviceId: string,
    date: string,
    excludeBookingId?: string,
  ) => Promise<{ start: string; end: string; blockedUntil: string }[]>;
};

export type ExecutionContext = {
  collection?: CollectionPin;
  kind: ExecutionKind;
  isolationLocked: boolean;
  effects: ExternalAction[];
  adapters: { calendar?: IsolatedCalendarPort };
};

export class IsolationViolation extends Error {
  readonly code = "isolation_violation";
  constructor(
    readonly effect: ExternalActionKind,
    readonly detail?: string,
  ) {
    super(
      detail
        ? `Isolated execution refused ${effect}: ${detail}`
        : `Isolated execution refused ${effect}`,
    );
  }
}

const storage = new AsyncLocalStorage<ExecutionContext>();
const live: ExecutionContext = {
  kind: "live",
  isolationLocked: false,
  effects: [],
  adapters: {},
};

export function createIsolatedExecution(): ExecutionContext {
  return { kind: "isolated", isolationLocked: true, effects: [], adapters: {} };
}

export function currentExecution(): ExecutionContext {
  return storage.getStore() ?? live;
}

export function isIsolatedExecution(): boolean {
  return currentExecution().kind === "isolated";
}

export function runWithExecution<T>(
  context: ExecutionContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const active = storage.getStore();
  if (active?.collection?.mode === "collection_only" && context.collection?.mode !== "collection_only")
    throw new Error("collection_policy_cannot_be_overridden");
  if (active?.kind === "isolated" && context.kind === "live") {
    throw new IsolationViolation(
      "provider.http",
      "live_context_cannot_override_isolation",
    );
  }
  if (active?.kind === "isolated") return fn();
  return storage.run(context, fn);
}

/** Scoped to the authorized domain adapter, not the queue/manual dashboard. */
export function withCollectionPolicy<T>(policy: CollectionPin | undefined, fn: () => T): T {
  const active = currentExecution();
  if (active.collection?.mode === "collection_only" && policy?.mode !== "collection_only")
    throw new Error("collection_policy_cannot_be_overridden");
  return storage.run({ ...active, collection: policy }, fn);
}
export function isCollectionOnly() { return currentExecution().collection?.mode === "collection_only"; }
export class CollectionEffectDenied extends Error {
  constructor(readonly effect: string) { super(`collection_only_denied:${effect}`); }
}
/** Deny by default. Informational reads/state return values do not call this. */
export function assertBusinessEffectAllowed(effect: string) {
  if (isCollectionOnly()) throw new CollectionEffectDenied(effect);
}

export function recordExternalAction(action: ExternalAction) {
  const context = storage.getStore();
  if (!context || context.kind !== "isolated") return;
  context.effects.push(action);
}

export function snapshotExternalActions(): ExternalAction[] {
  return currentExecution().effects.map((action) => ({ ...action }));
}

export function refuseIsolatedEffect(
  kind: ExternalActionKind,
  detail?: string,
): never {
  if (!isIsolatedExecution()) {
    throw new Error(`refuseIsolatedEffect called outside isolation: ${kind}`);
  }
  recordExternalAction({ kind, disposition: "BLOCKED", detail });
  throw new IsolationViolation(kind, detail);
}
