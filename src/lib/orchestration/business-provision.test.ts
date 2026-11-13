import { beforeEach, expect, it, vi } from "vitest";
import { businessProvisionAdapter } from "./business-provision";
import type { Action } from "./contracts";
import { runIsolated } from "@/lib/runtime/isolated-run";
const { provision, attach } = vi.hoisted(() => ({ provision: vi.fn(), attach: vi.fn() }));
vi.mock("@/lib/actions/provision", () => ({ provisionBusiness: provision }));
vi.mock("@/lib/prospects/instagram-scan", () => ({ attachProspectScanToInvitation: attach }));
beforeEach(() => { attach.mockReset(); attach.mockResolvedValue(true); provision.mockReset(); provision.mockResolvedValue({ businessId: "created", invitationUrl: "https://example.test/join", expiresAt: "later" }); });
const action: Action = { id: "action-1", instanceId: "instance", stepId: "create", tool: "business.provision", toolVersion: 1,
  input: { name: "Demo", email: "demo@example.test" }, inputDigest: "digest", status: "prepared" };
const context = { businessId: "business", conversationId: "conversation", revision: 8, signal: new AbortController().signal };
const adapter = () => businessProvisionAdapter({ businessId: "business", conversationId: "conversation", lease: { jobId: 5, leaseToken: "lease" }, versionForInstance: id => id === "instance" ? "version" : undefined });
it("binds retries to the durable action, not to a hash of customer values", async () => {
  await adapter().execute(action, context);
  await adapter().execute(action, context);
  await adapter().execute({ ...action, id: "action-2" }, context);
  expect(provision.mock.calls.map(([p]) => p.requestId)).toEqual(["process:conversation:action-1", "process:conversation:action-1", "process:conversation:action-2"]);
  expect(provision).toHaveBeenCalledWith(expect.objectContaining({ workflowVersionId: "version", nodeId: "create", guard: { jobId: 5, leaseToken: "lease", conversationId: "conversation", revision: 8 } }));
});
it("refuses a foreign tenant or isolated execution before calling the live domain", async () => {
  await expect(adapter().execute(action, { ...context, businessId: "foreign" })).rejects.toThrow("effect_scope_mismatch");
  await expect(runIsolated(() => adapter().execute(action, context))).rejects.toThrow("effect_scope_mismatch");
  expect(provision).not.toHaveBeenCalled();
});
it("simulates without reaching the live domain", async () => {
  const result = await runIsolated(() => adapter().simulate!(action));
  expect(result.businessId).toBe("simulation");
  expect(provision).not.toHaveBeenCalled();
});
it("does not dispatch after cancellation or when the pinned instance cannot be resolved", async () => {
  const controller = new AbortController(); controller.abort();
  expect((await adapter().execute(action, { ...context, signal: controller.signal })).status).toBe("failed");
  expect((await adapter().execute({ ...action, instanceId: "missing" }, context)).status).toBe("failed");
  expect(provision).not.toHaveBeenCalled();
});

it("links the chat's prospect scan to the new invitation and still succeeds when that fails", async () => {
  await expect(adapter().execute(action, context)).resolves.toMatchObject({ status: "succeeded" });
  expect(attach).toHaveBeenCalledWith({ businessId: "business", conversationId: "conversation", targetBusinessId: "created" });
  attach.mockRejectedValueOnce(new Error("db"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(adapter().execute(action, context)).resolves.toMatchObject({ status: "succeeded", output: { invitationUrl: "https://example.test/join" } });
});
