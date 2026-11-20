import { describe, expect, it, vi } from "vitest";
import { exitLabel, failureKind } from "./labels";

const recorded = vi.hoisted(() => [] as { capability: string; point: string; reason?: string; businessId: string | null }[]);
const last = vi.hoisted(() => ({ at: null as string | null }));
vi.mock("./events", () => ({ recordCapabilityEvents: async (events: typeof recorded) => { recorded.push(...events); }, lastRecordedAt: async () => last.at }));
const { metaCode, recordStepFailed, trackScheduledJob } = await import("./system-events");

describe("platform tracking", () => {
  it("records a scheduled run's outcome, but not a call without the scheduler's secret", async () => {
    recorded.length = 0;
    await trackScheduledJob("source-refresh", async () => new Response(null, { status: 401 }));
    await trackScheduledJob("source-refresh", async () => Response.json({ ok: true }));
    await trackScheduledJob("source-refresh", async () => Response.json({ error: "x" }, { status: 503 }));
    expect(recorded.map(e => [e.capability, e.point, e.reason ?? null, e.businessId])).toEqual([
      ["system.cron.source_refresh", "completed", null, null], ["system.cron.source_refresh", "failed", "http_503", null]]);
  });

  it("keeps every failure of a frequent run, but a success at most once an hour", async () => {
    recorded.length = 0;
    last.at = new Date(Date.now() - 5 * 60000).toISOString();
    await trackScheduledJob("workflow-inbound", async () => Response.json({ processed: 0 }));
    await trackScheduledJob("workflow-inbound", async () => Response.json({ error: "x" }, { status: 503 }));
    last.at = new Date(Date.now() - 61 * 60000).toISOString();
    await trackScheduledJob("workflow-inbound", async () => Response.json({ processed: 0 }));
    last.at = null;
    expect(recorded.map(e => e.point)).toEqual(["failed", "completed"]);
  });

  it("keeps the step and the code of a failed job step", async () => {
    recorded.length = 0;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordStepFailed("system.discovery", "b1", "instagram_capture", new Error("lease_expired"));
    await recordStepFailed("system.discovery", "b1", "instagram_capture", new TypeError("cannot read x"));
    expect(recorded.map(e => e.reason)).toEqual(["instagram_capture:lease_expired", "instagram_capture:unexpected"]);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("names Meta's errors by code only, and reads them back for Platform Admin", () => {
    expect(metaCode({ code: 100, error_subcode: 33 })).toBe("meta_100_33");
    expect(metaCode(null)).toBe("meta_unknown");
    expect(exitLabel("webhook_failed", "meta_100_33")).toBe("Mesazhet nuk u aktivizuan: Meta refuzoi (kodi 100/33)");
    expect(exitLabel("step_failed", "instagram_capture:unexpected")).toBe("Një hap dështoi (instagram capture): gabim në kod");
    expect([failureKind("capture:unexpected"), failureKind("meta_100"), failureKind("stale"), failureKind("error")]).toEqual(["bug", "external", "check", "bug"]);
  });
});
