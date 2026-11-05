import { describe, expect, it, vi } from "vitest";
import { initialSnapshot, type Action, type ProcessDefinition } from "./contracts";
import { digest } from "./definition";
import { executePreparedAction, type ExecutionStore, type ToolAdapter } from "./execute";
import { type Environment } from "./transition";

function setup() {
  const definition: ProcessDefinition = { id: "request", versionId: "v1", businessId: "business", name: "Request", purpose: "Collect a request", offerPolicy: "on_request", entry: "send", fields: [],
    steps: [{ id: "send", kind: "effect", tool: "request.save", toolVersion: 1, inputs: {}, next: "done", failed: "staff" },
      { id: "done", kind: "end", label: "Saved" }, { id: "staff", kind: "handoff", label: "Needs staff" }] };
  const env: Environment = { mode: "test", now: Date.now(), promptTtlMs: 60000, startableVersionIds: new Set(["v1"]), definitions: [definition],
    tools: [{ key: "request.save", version: 1, allowed: true, effect: "write", approval: "none", inputs: [] }] };
  const state = initialSnapshot("business", "conversation", "test");
  const action: Action = { id: "action", instanceId: "instance", stepId: "send", tool: "request.save", toolVersion: 1, input: {}, inputDigest: digest({}), status: "prepared" };
  state.instances.instance = { id: "instance", definitionId: "request", versionId: "v1", stepId: "send", status: "waiting_effect", facts: {}, action };
  const adapter: ToolAdapter = { key: "request.save", version: 1, execute: vi.fn(async () => ({ status: "succeeded" as const, output: {} })), simulate: vi.fn(async () => ({ simulated: true })) };
  const store: ExecutionStore = { claim: vi.fn(async snapshot => ({ replayed: false, state: snapshot })), finish: vi.fn(async () => {}) };
  return { state, env, instanceId: "instance", actionId: "action", adapters: [adapter], store, deadline: Date.now() + 5000, adapter };
}
describe("durable effect boundary", () => {
  it("test execution calls only the simulation adapter and labels its result", async () => {
    const input = setup();
    const result = await executePreparedAction(input);
    expect(input.adapter.execute).not.toHaveBeenCalled();
    expect(input.adapter.simulate).toHaveBeenCalledTimes(1);
    expect(result.state.instances.instance.action?.status).toBe("simulated");
    expect(input.store.finish).toHaveBeenCalledTimes(1);
  });
  it("missing simulation cannot fall through to a live effect", async () => {
    const input = setup();
    delete input.adapter.simulate;
    await expect(executePreparedAction(input)).rejects.toThrow("simulation_unavailable");
    expect(input.adapter.execute).not.toHaveBeenCalled();
    expect(input.store.claim).not.toHaveBeenCalled();
  });
  it("cannot switch an existing test conversation to live execution", async () => {
    const input = setup();
    input.env.mode = "live";
    await expect(executePreparedAction(input)).rejects.toThrow("execution_mode_mismatch");
    expect(input.adapter.execute).not.toHaveBeenCalled();
    expect(input.store.claim).not.toHaveBeenCalled();
  });
  it("never executes if the durable claim fails", async () => {
    const input = setup();
    input.store.claim = vi.fn(async () => { throw new Error("stale_state"); });
    await expect(executePreparedAction(input)).rejects.toThrow("stale_state");
    expect(input.adapter.simulate).not.toHaveBeenCalled();
  });
  it("does not redispatch a replayed action claim", async () => {
    const input = setup();
    input.store.claim = vi.fn(async state => ({ replayed: true, state }));
    expect((await executePreparedAction(input)).disposition).toBe("replayed");
    expect(input.adapter.simulate).not.toHaveBeenCalled();
    expect(input.store.finish).not.toHaveBeenCalled();
  });
  it("an exception after live dispatch records uncertainty instead of success or a blind retry", async () => {
    const input = setup();
    input.env.mode = "live";
    input.state.mode = "live";
    input.adapter.execute = vi.fn(async () => { throw new Error("provider_response_lost"); });
    const result = await executePreparedAction(input);
    expect(result.state.instances.instance.action?.status).toBe("unknown");
    expect(result.state.instances.instance.status).toBe("waiting_effect");
    expect(result.transition?.actions).toEqual([]);
  });
  it("a lost receipt commit leaves a durable running claim and never repeats the adapter", async () => {
    const input = setup();
    input.store.finish = vi.fn(async () => { throw new Error("commit_response_lost"); });
    await expect(executePreparedAction(input)).rejects.toThrow("commit_response_lost");
    expect(input.adapter.simulate).toHaveBeenCalledTimes(1);
    const claim = vi.mocked(input.store.claim).mock.calls[0][0];
    expect(claim.instances.instance.action?.status).toBe("running");
    await expect(executePreparedAction({ ...input, state: claim })).rejects.toThrow("action_not_dispatchable");
    expect(input.adapter.simulate).toHaveBeenCalledTimes(1);
  });
  it("persists a completed effect even when the following step fails authorization", async () => {
    const input = setup();
    input.env.mode = "live";
    input.state.mode = "live";
    const first = input.env.definitions[0].steps[0];
    if (first.kind !== "effect") throw new Error("fixture");
    first.next = "second";
    input.env.definitions[0].steps.push({ id: "second", kind: "effect", tool: "request.publish", toolVersion: 1, inputs: {}, next: "done", failed: "staff" });
    input.env.tools.push({ key: "request.publish", version: 1, effect: "write", approval: "required", allowed: true, inputs: [] });
    const result = await executePreparedAction(input);
    expect(result.state.instances.instance.action?.status).toBe("succeeded");
    expect(result.state.instances.instance.status).toBe("failed");
    expect(result.state.instances.instance.lastError).toBe("approval_required");
    expect(input.store.finish).toHaveBeenCalledTimes(1);
    expect(result.transition?.actions).toEqual([]);
  });
});
