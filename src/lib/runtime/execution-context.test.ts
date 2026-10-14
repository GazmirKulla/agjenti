import { expect, it } from "vitest";
import {
  IsolationViolation,
  createIsolatedExecution,
  isIsolatedExecution,
  recordExternalAction,
  refuseIsolatedEffect,
  runWithExecution,
  snapshotExternalActions,
} from "./execution-context";
import { isolatedWithoutAdapters, runIsolated } from "./isolated-run";

it("locks isolated execution so live context cannot take over", async () => {
  await runIsolated(async () => {
    expect(isIsolatedExecution()).toBe(true);
    expect(() =>
      runWithExecution(
        { kind: "live", isolationLocked: false, effects: [], adapters: {} },
        () => "live",
      ),
    ).toThrow(IsolationViolation);
    expect(isIsolatedExecution()).toBe(true);
  });
  expect(isIsolatedExecution()).toBe(false);
});

it("does not let model-shaped configuration unlock isolation", async () => {
  await runIsolated(async () => {
    const forged = {
      kind: "live" as const,
      isolationLocked: false,
      effects: [],
      adapters: {},
      mode: "production",
    };
    expect(isIsolatedExecution()).toBe(true);
    expect(() => runWithExecution(forged, () => "ok")).toThrow(IsolationViolation);
  });
});

it("fails closed when a live effect is requested without a test adapter", async () => {
  await isolatedWithoutAdapters(async () => {
    expect(() => refuseIsolatedEffect("booking.create", "missing_test_adapter")).toThrow(
      IsolationViolation,
    );
    expect(snapshotExternalActions()).toEqual([
      { kind: "booking.create", disposition: "BLOCKED", detail: "missing_test_adapter" },
    ]);
  });
});

it("records simulated actions only inside isolated execution", () => {
  recordExternalAction({ kind: "order.create", disposition: "SIMULATED" });
  expect(snapshotExternalActions()).toEqual([]);
  return runIsolated(() => {
    recordExternalAction({ kind: "order.create", disposition: "SIMULATED" });
    expect(snapshotExternalActions()).toEqual([
      { kind: "order.create", disposition: "SIMULATED" },
    ]);
  });
});

it("keeps adapter-less isolated contexts from gaining the default calendar port", async () => {
  const empty = createIsolatedExecution();
  expect(empty.adapters.calendar).toBeUndefined();
  await isolatedWithoutAdapters(async () => {
    expect(createIsolatedExecution().adapters.calendar).toBeUndefined();
  });
});
