import { TransitionError, type Action, type Snapshot, type Transition, type Value } from "./contracts";
import { digest, validKey } from "./definition";
import { authorizeDispatch, transitionActionDispatch, transitionActionResult, type Environment } from "./transition";

export type EffectResult = { status: "succeeded" | "failed" | "unknown"; output: Record<string, Value> };
export type EffectReceipt = { actionId: string; inputDigest: string; status: "simulated" | EffectResult["status"]; output: Record<string, Value> };
export type ToolAdapter = {
  key: string;
  version: number;
  /** An exception after dispatch is uncertain. A definite rejection must return failed. */
  execute: (action: Action, context: { businessId: string; conversationId: string; revision: number; signal: AbortSignal }) => Promise<EffectResult>;
  simulate?: (action: Action) => Promise<Record<string, Value>>;
  /** Read an existing domain receipt only. Absence is not proof of failure. */
  reconcile?: (action: Action, context: { businessId: string; conversationId: string; revision: number; signal: AbortSignal }) => Promise<EffectResult | null>;
};
export type ExecutionStore = {
  /** CAS + event deduplication + current lease/ownership checks in one transaction. */
  claim: (state: Snapshot, expectedRevision: number, actionId: string) => Promise<{ replayed: boolean; state: Snapshot }>;
  /** Atomically persist the receipt and the resulting checkpoint. */
  finish: (transition: Transition, expectedRevision: number, receipt: EffectReceipt) => Promise<void>;
};
export function validOutput(output: unknown): output is Record<string, Value> {
  return output !== null && typeof output === "object" && !Array.isArray(output) && Object.keys(output).length <= 32
    && Object.entries(output).every(([key, value]) => validKey(key) && (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)
      || typeof value === "string" && value.length <= 8000 || Array.isArray(value) && value.length <= 32 && value.every(v => typeof v === "string" && v.length <= 2000)));
}

/** Server-only orchestration; adapters still enforce domain permissions in their effect transaction. */
export async function executePreparedAction(input: {
  state: Snapshot; instanceId: string; actionId: string; env: Environment;
  adapters: ToolAdapter[]; store: ExecutionStore; deadline: number;
}): Promise<{ state: Snapshot; disposition: "replayed" | "recorded"; transition?: Transition }> {
  const currentEnv = { ...input.env, now: Date.now() };
  const action = authorizeDispatch(input.state, input.instanceId, input.actionId, currentEnv);
  const adapter = input.adapters.find(a => a.key === action.tool && a.version === action.toolVersion);
  if (!adapter) throw new TransitionError("adapter_unavailable");
  if (input.env.mode === "test" && !adapter.simulate) throw new TransitionError("simulation_unavailable");
  if (input.deadline - Date.now() < 1000) throw new TransitionError("execution_budget_exhausted");
  const claim = await input.store.claim(transitionActionDispatch(input.state, input.instanceId, action.id, currentEnv), input.state.revision, action.id);
  if (claim.replayed) return { state: claim.state, disposition: "replayed" };
  const claimed = claim.state.instances[input.instanceId]?.action;
  if (claim.state.businessId !== input.state.businessId || claim.state.conversationId !== input.state.conversationId
    || claim.state.revision !== input.state.revision + 1 || claimed?.id !== action.id || claimed.status !== "running"
    || claimed.inputDigest !== action.inputDigest || digest(claimed.input) !== action.inputDigest) throw new TransitionError("invalid_action_claim");
  let receipt: { status: "simulated" | EffectResult["status"]; output: Record<string, Value> };
  const remaining = input.deadline - Date.now();
  if (remaining <= 0 || action.approval && action.approval.expiresAt <= Date.now()) receipt = { status: "failed", output: {} }; // No dispatch occurred.
  else {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        receipt = await Promise.race([
          input.env.mode === "test"
            ? adapter.simulate!(structuredClone(action)).then(output => ({ status: "simulated" as const, output }))
            : adapter.execute(structuredClone(action), { businessId: claim.state.businessId, conversationId: claim.state.conversationId, revision: claim.state.revision, signal: controller.signal }),
          new Promise<EffectResult>(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ status: input.env.mode === "test" ? "failed" : "unknown", output: {} }); }, remaining); }),
        ]);
      } catch { receipt = { status: input.env.mode === "test" ? "failed" : "unknown", output: {} }; }
      finally { if (timer) clearTimeout(timer); }
  }
  if (!receipt || !new Set(input.env.mode === "test" ? ["simulated", "failed"] : ["succeeded", "failed", "unknown"]).has(receipt.status) || !validOutput(receipt.output)) {
    receipt = { status: input.env.mode === "test" ? "failed" : "unknown", output: {} };
  }
  const transition = transitionActionResult(claim.state, { instanceId: input.instanceId, actionId: action.id, ...receipt }, { ...input.env, now: Date.now() });
  // A failed receipt commit propagates. The persisted running claim prevents redispatch.
  await input.store.finish(transition, claim.state.revision, { actionId: action.id, inputDigest: action.inputDigest, ...receipt });
  return { state: transition.state, disposition: "recorded", transition };
}
