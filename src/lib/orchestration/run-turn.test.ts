import { beforeEach, expect, it, vi } from "vitest";
import { runProcessTurn } from "./run-turn";
import { initialSnapshot, type Snapshot, type ProcessDefinition } from "./contracts";
import { digest } from "./definition";
import type { Environment } from "./transition";
const { commit, finish } = vi.hoisted(() => ({ commit: vi.fn(), finish: vi.fn() }));
vi.mock("./persistence", () => ({ commitProcessCheckpoint: commit, processExecutionStore: () => ({ claim: vi.fn(), finish }) }));
beforeEach(() => { finish.mockReset(); commit.mockReset(); commit.mockImplementation(async p => ({ state: p.transition.state, replayed: false })); });
const env: Environment = { mode: "live", now: Date.now(), definitions: [], startableVersionIds: new Set(), tools: [], promptTtlMs: 60000 };
const event = { id: "job:1:customer", businessId: "b", conversationId: "c", actor: "customer" as const, message: "Explain" };
function input(state = initialSnapshot("b", "c", "live")) {
  return { state, event, env, deadline: Date.now() + 10000, adapters: [], lease: { jobId: 1, leaseToken: "lease" },
    interpret: vi.fn(async () => ({ revision: state.revision, commands: [], needsClarification: false })) };
}
it("durably records interpretation before returning a turn for composition", async () => {
  const result = await runProcessTurn(input());
  expect(commit).toHaveBeenCalledOnce();
  expect(result.state.pendingTurn).toEqual({ eventId: event.id, messageDigest: digest(event.message), notices: [] });
  expect(result.state.revision).toBe(1);
});
it("recovers a committed turn without reinterpreting or creating another instance", async () => {
  const first = await runProcessTurn(input()); commit.mockClear();
  const retry = input(first.state);
  expect((await runProcessTurn(retry)).state).toEqual(first.state);
  expect(retry.interpret).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});
it("does not dispatch again when the running action has no durable result", async () => {
  const state = (await runProcessTurn(input())).state;
  state.instances.instance = { id: "instance", definitionId: "d", versionId: "v", stepId: "effect", status: "waiting_effect", facts: {},
    action: { id: "a", instanceId: "instance", stepId: "effect", tool: "tool", toolVersion: 1, input: {}, inputDigest: digest({}), status: "running" } };
  const request = input(state as Snapshot);
  const result = await runProcessTurn(request);
  expect(result.notices).toEqual([{ kind: "blocked", reason: "effect_reconciliation_required" }]);
  expect(request.interpret).not.toHaveBeenCalled();
  expect(result.state.instances.instance.action?.status).toBe("running");
});
it("rejects a different message presented as a retry of the pending event", async () => {
  const state = (await runProcessTurn(input())).state;
  await expect(runProcessTurn({ ...input(state), event: { ...event, message: "Different" } })).rejects.toThrow("unfinished_process_turn");
});

function recovering() {
  const state = initialSnapshot("b", "c", "live");
  state.pendingTurn = { eventId: event.id, messageDigest: digest(event.message), notices: [] };
  state.instances.instance = { id: "instance", definitionId: "d", versionId: "v", stepId: "effect", status: "waiting_effect", facts: {},
    action: { id: "a", instanceId: "instance", stepId: "effect", tool: "tool", toolVersion: 1, input: {}, inputDigest: digest({}), status: "unknown" } };
  const definition: ProcessDefinition = { id: "d", versionId: "v", businessId: "b", name: "Request", purpose: "Save", offerPolicy: "on_request", entry: "effect", fields: [],
    steps: [{ id: "effect", kind: "effect", tool: "tool", toolVersion: 1, inputs: {}, next: "done", failed: "done" }, { id: "done", kind: "end", label: "Finished" }] };
  const adapter = { key: "tool", version: 1, execute: vi.fn(), reconcile: vi.fn(async () => ({ status: "succeeded" as const, output: { receiptId: "saved" } })) };
  return { ...input(state), adapters: [adapter], env: { ...env, definitions: [definition] } };
}
it("recovers a durable domain receipt without executing or interpreting again", async () => {
  const request = recovering();
  const result = await runProcessTurn(request);
  expect(result.state.instances.instance.action).toMatchObject({ status: "succeeded", output: { receiptId: "saved" } });
  expect(result.state.instances.instance.status).toBe("completed");
  expect(finish).toHaveBeenCalledOnce();
  expect(request.adapters[0].execute).not.toHaveBeenCalled();
  expect(request.interpret).not.toHaveBeenCalled();
});
it("validates pending event identity before reading or committing a receipt", async () => {
  const request = recovering();
  await expect(runProcessTurn({ ...request, event: { ...event, message: "changed" } })).rejects.toThrow("unfinished_process_turn");
  expect(request.adapters[0].reconcile).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
});
it("preserves uncertainty when the receipt store is unavailable", async () => {
  const request = recovering();
  request.adapters[0].reconcile.mockRejectedValue(new Error("offline"));
  const result = await runProcessTurn(request);
  expect(result.state.instances.instance.action?.status).toBe("unknown");
  expect(result.notices).toEqual([{ kind: "blocked", reason: "effect_reconciliation_required" }]);
  expect(finish).not.toHaveBeenCalled();
  expect(request.adapters[0].execute).not.toHaveBeenCalled();
});
it("propagates a receipt checkpoint failure without retrying the effect", async () => {
  const request = recovering();
  finish.mockRejectedValue(new Error("checkpoint unavailable"));
  await expect(runProcessTurn(request)).rejects.toThrow("checkpoint unavailable");
  expect(request.adapters[0].execute).not.toHaveBeenCalled();
});
