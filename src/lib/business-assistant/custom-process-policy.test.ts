import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ published: false as boolean | Error }));
vi.mock("@/lib/orchestration/automatic-process", () => ({ ownProcessPublished: async () => { if (m.published instanceof Error) throw m.published; return m.published; } }));
import { customProcessRefusal, settingsInstead } from "./custom-process-policy";

const business = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { m.published = false; });

describe("the Assistant and processes the owner would have to draw", () => {
  it("never creates one for a business that runs the automatic process, and points to the settings", async () => {
    for (const action of ["workflow_draft", "workflow_publish", "orderflow_create", "orderflow_assign", "workflow.configure"])
      expect(await customProcessRefusal(business, action)).toBe(settingsInstead);
  });
  it("keeps changing a process the owner already published, and always lets it be read or switched off", async () => {
    m.published = true;
    expect(await customProcessRefusal(business, "workflow_draft")).toBeNull();
    m.published = false;
    for (const action of ["workflow_read", "workflow_load", "orderflow_read", "linear_read", "workflow_disable"]) expect(await customProcessRefusal(business, action)).toBeNull();
  });
  it("never creates or changes an old per-product process, even next to a published one", async () => {
    m.published = true;
    for (const action of ["linear_draft", "linear_link", "linear_publish"]) expect(await customProcessRefusal(business, action)).toBe(settingsInstead);
  });
  it("refuses when the business's process cannot be verified", async () => {
    m.published = new Error("down");
    expect(await customProcessRefusal(business, "workflow_draft")).toContain("Nuk u verifikua");
  });
});
