import { describe, expect, it } from "vitest";
import { billingState, type BillingUsage } from "./service";

const usage = (changes: Partial<BillingUsage> = {}): BillingUsage => ({
  plan: "free", limit: 1_000, used: 0, reserved: 0, extra: 0, extraReserved: 0,
  available: 1_000, periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", ...changes,
});

describe("billingState", () => {
  it("warns at the agreed 80% and 95% thresholds", () => {
    expect(billingState(usage({ used: 800, available: 200 })).level).toBe("warning");
    expect(billingState(usage({ used: 950, available: 50 })).level).toBe("urgent");
  });

  it("blocks only when no monthly or extra allowance remains", () => {
    expect(billingState(usage({ used: 1_000, extra: 10, available: 10 }))).toMatchObject({ level: "urgent", exhausted: false });
    expect(billingState(usage({ used: 1_000, available: 0 }))).toMatchObject({ level: "exhausted", exhausted: true });
  });
});
