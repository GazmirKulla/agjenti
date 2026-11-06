import { TransitionError, type CustomerEvent, type Observation, type Snapshot, type Transition } from "./contracts";
import { digest } from "./definition";
import { transitionCustomer, transitionActionResult, type Environment } from "./transition";
import { executePreparedAction, validOutput, type ToolAdapter } from "./execute";
import { commitProcessCheckpoint, processExecutionStore, type ProcessLease } from "./persistence";

/** One turn protocol for isolated and live execution. Recover persisted work before interpreting again. */
export async function runProcessTurn(input: {
  state: Snapshot; event: CustomerEvent; env: Environment; deadline: number;
  interpret: () => Promise<Observation>; adapters: ToolAdapter[]; lease?: ProcessLease;
  onState?: (state: Snapshot) => void;
  validate?: (transition: Transition) => void;
}): Promise<Transition> {
  let state = structuredClone(input.state);
  const live = input.env.mode === "live";
  if (live && !input.lease) throw new TransitionError("process_lease_required");
  const recoveryNotices: Transition["notices"] = [];
  if (live) for (const instance of Object.values(state.instances)) {
    const action = instance.action;
    if (!action || action.status !== "running" && action.status !== "unknown") continue;
    const adapter = input.adapters.find(a => a.key === action.tool && a.version === action.toolVersion);
    if (!adapter?.reconcile || input.deadline - Date.now() < 1000) continue;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const receipt = await Promise.race([
        adapter.reconcile(action, { businessId: state.businessId, conversationId: state.conversationId, revision: state.revision, signal: controller.signal }),
        new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, Math.min(5000, input.deadline - Date.now())); }),
      ]);
      if (!receipt || receipt.status === "unknown" || !validOutput(receipt.output)) continue;
      const next = transitionActionResult(state, { instanceId: instance.id, actionId: action.id, ...receipt }, { ...input.env, now: Date.now() });
      if (next.state.pendingTurn) next.state.pendingTurn.notices.push(...next.notices);
      await processExecutionStore({ businessId: state.businessId, conversationId: state.conversationId, lease: input.lease! })
        .finish(next, state.revision, { actionId: action.id, inputDigest: action.inputDigest, ...receipt });
      state = next.state; if (!state.pendingTurn) recoveryNotices.push(...next.notices); input.onState?.(state);
    } finally { if (timer) clearTimeout(timer); }
  }
  const messageDigest = digest(input.event.message);
  let result: Transition;
  if (state.pendingTurn) {
    if (state.pendingTurn.eventId !== input.event.id || state.pendingTurn.messageDigest !== messageDigest) throw new TransitionError("unfinished_process_turn");
    result = { state, notices: state.pendingTurn.notices, actions: Object.values(state.instances).flatMap(i => i.action?.status === "prepared" ? [i.action] : []) };
  } else {
    const observation = await input.interpret();
    try { result = transitionCustomer(state, input.event, observation, { ...input.env, now: Date.now() }); }
    catch (error) {
      if (!(error instanceof TransitionError)) throw error;
      result = { state: { ...state, revision: state.revision + 1 }, notices: [{ kind: "clarify", reason: error.code }], actions: [] };
    }
    result.state.pendingTurn = { eventId: input.event.id, messageDigest, notices: result.notices };
    input.validate?.(result);
    if (live) {
      const receipt = await commitProcessCheckpoint({ event: input.event, expectedRevision: state.revision, transition: result, lease: input.lease! });
      result.state = receipt.state;
      if (receipt.replayed) result = { state: receipt.state, notices: receipt.state.pendingTurn?.notices ?? [], actions: Object.values(receipt.state.instances).flatMap(i => i.action?.status === "prepared" ? [i.action] : []) };
    }
  }
  state = result.state;
  input.onState?.(state);
  if (Object.values(state.instances).some(i => i.action?.status === "running" || i.action?.status === "unknown")) {
    // The provider might already have committed. Never retry an uncertain side effect.
    return { state, actions: [], notices: [{ kind: "blocked", reason: "effect_reconciliation_required" }] };
  }
  const notices = [...recoveryNotices, ...result.notices], pending = [...new Map([...result.actions, ...Object.values(state.instances).flatMap(i => i.action?.status === "prepared" ? [i.action] : [])].map(a => [a.id, a])).values()];
  const durable = live ? processExecutionStore({ businessId: state.businessId, conversationId: state.conversationId, lease: input.lease! }) : null;
  for (let count = 0; pending.length; count++) {
    if (count >= 4) throw new TransitionError("execution_budget_exhausted");
    const action = pending.shift()!;
    const executed = await executePreparedAction({ state, instanceId: action.instanceId, actionId: action.id, env: input.env, adapters: input.adapters, deadline: input.deadline,
      store: {
        async claim(next, expected, actionId) {
          if (durable) return durable.claim(next, expected, actionId);
          if (state.revision !== expected) throw new TransitionError("stale_state");
          state = next; return { state, replayed: false };
        },
        async finish(next, expected, receipt) {
          next.state.pendingTurn = { eventId: input.event.id, messageDigest, notices: [...notices, ...next.notices] };
          if (durable) await durable.finish(next, expected, receipt);
          else if (state.revision !== expected) throw new TransitionError("stale_state");
          state = next.state;
        },
      },
    });
    state = executed.state;
    input.onState?.(state);
    notices.push(...(executed.transition?.notices ?? []));
    pending.push(...(executed.transition?.actions ?? []));
  }
  return { state, notices, actions: [] };
}
