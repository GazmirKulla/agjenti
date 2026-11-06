import { beforeEach, expect, it, vi } from "vitest";
import { runProcessTurn } from "./run-turn";
import { initialSnapshot, type Snapshot } from "./contracts";
import { digest } from "./definition";
import type { Environment } from "./transition";
const { commit } = vi.hoisted(() => ({ commit: vi.fn() }));
vi.mock("./persistence", () => ({ commitProcessCheckpoint: commit, processExecutionStore: () => ({ claim: vi.fn(), finish: vi.fn() }) }));
beforeEach(() => { commit.mockReset(); commit.mockImplementation(async p => ({ state: p.transition.state, replayed: false })); });
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
