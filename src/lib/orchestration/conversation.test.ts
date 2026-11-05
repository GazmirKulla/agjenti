import { beforeEach, expect, it, vi } from "vitest";
import { initialSnapshot } from "./contracts";
import { emptyState } from "@/lib/workflows/state";
import { runIsolated } from "@/lib/runtime/isolated-run";
import { tryProcessConversation } from "./conversation";

const { load, interpret } = vi.hoisted(() => ({ load: vi.fn(), interpret: vi.fn() }));
vi.mock("@/lib/workflows/visual/store", () => ({ loadVisualVersion: load }));
vi.mock("./interpret", () => ({ interpretCustomer: interpret }));
beforeEach(() => { vi.clearAllMocks(); load.mockResolvedValue(null); });
const params = () => ({ businessId: "business", message: "Continue", hasPhoto: false, mode: "test" as const,
  state: { ...emptyState(), runtime: initialSnapshot("business", "conversation", "test") } });

it("never falls back to legacy parsing for a v4 session outside isolated execution", async () => {
  await expect(tryProcessConversation(params())).rejects.toThrow("process_transport_cutover_required");
  expect(interpret).not.toHaveBeenCalled();
});
it("never hands a v4 session to the linear preview adapter", async () => {
  const input = { ...params(), linearPreview: {} as NonNullable<Parameters<typeof tryProcessConversation>[0]["linearPreview"]> };
  await expect(runIsolated(() => tryProcessConversation(input))).rejects.toThrow("process_session_restart_required");
  expect(load).not.toHaveBeenCalled();
});
it("rejects a foreign preview before loading configuration or interpreting the message", async () => {
  const input = { ...params(), visualPreview: { businessId: "foreign" } as NonNullable<Parameters<typeof tryProcessConversation>[0]["visualPreview"]> };
  await expect(runIsolated(() => tryProcessConversation(input))).rejects.toThrow("definition_scope_mismatch");
  expect(interpret).not.toHaveBeenCalled();
});
it("keeps an unconverted live session on its existing transport during construction", async () => {
  await expect(tryProcessConversation({ ...params(), state: emptyState(), mode: "production" })).resolves.toBeNull();
  expect(load).not.toHaveBeenCalled();
});
