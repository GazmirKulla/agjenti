import { describe, expect, it } from "vitest";
import { capabilityGroups, toggleCapabilityGroup } from "./capability-groups";
import { allowedCapabilities, capabilityChoices } from "./rules";

describe("capability groups", () => {
  it("covers every supported capability once in five groups", () => {
    const groups = capabilityGroups(capabilityChoices);
    expect(groups).toHaveLength(5);
    const ids = groups.flatMap(group => group.capabilities);
    expect(ids.sort()).toEqual(capabilityChoices.map(([id]) => id).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("only groups allowed capabilities and does not describe orders for a support-only service", () => {
    const options = allowedCapabilities("professional", ["services"], ["support"]);
    const groups = capabilityGroups(options);
    expect(groups.map(group => group.id)).toEqual(["answers", "requests", "handoff"]);
    expect(groups.find(group => group.id === "requests")?.label).toBe("Sqarimi i bisedës");
    expect(groups.flatMap(group => group.capabilities)).not.toContain("create_order");
  });
  it("completes partial choices then removes only that group, preserving other selections", () => {
    const selected = toggleCapabilityGroup(["reply_messages", "handoff"], ["reply_messages", "answer_questions"]);
    expect(selected).toEqual(["reply_messages", "handoff", "answer_questions"]);
    expect(toggleCapabilityGroup(selected, ["reply_messages", "answer_questions"])).toEqual(["handoff"]);
  });
});
