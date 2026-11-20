import { describe, expect, it, vi } from "vitest";
import { OperationError } from "@/lib/actions/operations/error";
import { AssistantError } from "@/lib/business-assistant/model";
import { PersistenceError } from "@/lib/business-assistant/persistence";
import { failureCode } from "./failure";
import { withAssistantRequest } from "./assistant-request";

const recorded = vi.hoisted(() => [] as { point: string; reason?: string; ref?: string }[][]);
vi.mock("./events", () => ({ recordCapabilityEvents: async (events: { point: string; reason?: string; ref?: string }[]) => { recorded.push(events); } }));
const { trackAssistantExecution, trackAssistantPreparation } = await import("./assistant-events");

describe("failure codes", () => {
  it("names the kind of failure from the error the server raised", () => {
    expect(failureCode(new AssistantError("x"))).toBe("assistant_refusal");
    expect(failureCode(new OperationError("x", "stale"))).toBe("stale");
    expect(failureCode(new OperationError("x"))).toBe("check_failed");
    expect(failureCode(new PersistenceError("x", 409))).toBe("stale");
    expect(failureCode(new PersistenceError("x", 418))).toBe("check_failed");
    expect(failureCode(new TypeError("x is not a function"))).toBe("unexpected");
    expect(failureCode("boom")).toBe("unexpected");
  });

  it("ties a failed preparation to the owner's request and keeps its code", async () => {
    recorded.length = 0;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(withAssistantRequest("req-1", () => trackAssistantPreparation("b", "assistant.agent.behavior", "fallback",
      async () => { throw new OperationError("Zgjidh", "invalid_input"); }))).rejects.toThrow();
    expect(recorded[0]).toEqual([expect.objectContaining({ point: "requested", ref: "req-1" }), expect.objectContaining({ point: "failed", reason: "invalid_input", ref: "req-1" })]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("logs only an unexpected failure, with where it happened", async () => {
    recorded.length = 0;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(trackAssistantExecution("b", "assistant.agent.behavior", "op-1", async () => { throw new TypeError("broken"); })).rejects.toThrow();
    expect(recorded[0][0]).toMatchObject({ point: "execution_failed", reason: "unexpected", ref: "op-1" });
    expect(error).toHaveBeenCalledWith("capability_unexpected_failure", expect.stringContaining("\"where\":\"assistant_execution\""));
    error.mockRestore();
  });
});
