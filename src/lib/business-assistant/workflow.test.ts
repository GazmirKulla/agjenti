import { describe, expect, it } from "vitest";
import {
  starterVisualGraph,
  validateVisualGraph,
} from "@/lib/workflows/visual/model";
import { applyWorkflowOperations, workflowPreview } from "./workflow";
import { readProposal } from "./model";

describe("assistant workflow operations", () => {
  it("inserts a phone question on one branch, preserving unrelated nodes and branches", () => {
    const before = starterVisualGraph();
    const existing = before.edges.find(
      (e) => e.source === "order" && e.port === "yes",
    )!;
    const after = applyWorkflowOperations(
      before,
      JSON.stringify([
        {
          op: "put_node",
          node: {
            id: "phone",
            kind: "collect",
            label: "Telefoni",
            position: { x: 500, y: 300 },
            config: {
              fieldKey: "contact_phone",
              fieldType: "phone",
              prompt: "Cili është numri i telefonit?",
            },
          },
        },
        { op: "put_edge", edge: { ...existing, target: "phone" } },
        {
          op: "put_edge",
          edge: {
            id: "phone_next",
            source: "phone",
            target: existing.target,
            port: "next",
          },
        },
      ]),
    );
    expect(validateVisualGraph(after).errors).toEqual([]);
    expect(after.nodes.filter((n) => n.id !== "phone")).toEqual(before.nodes);
    expect(after.edges.filter((e) => e.source === "support")).toEqual(
      before.edges.filter((e) => e.source === "support"),
    );
    expect(before.nodes.some((n) => n.id === "phone")).toBe(false);
    const diff = workflowPreview(before, after);
    expect(
      diff.fields.some(
        (f) => f.label === "Hap i shtuar" && f.after.includes("Telefoni"),
      ),
    ).toBe(true);
    expect(
      diff.fields.some(
        (f) =>
          f.label === "Hap i ndryshuar" && f.after.includes("Po → Telefoni"),
      ),
    ).toBe(true);
  });
  it("rejects unknown operations, removing start, nonexistent targets and executable node types", () => {
    for (const ops of [
      [],
      [{ op: "delete_business" }],
      [{ op: "remove_node", id: "start" }],
      [{ op: "remove_node", id: "absent" }],
      [{ op: "remove_edge", id: "absent" }],
      [
        {
          op: "put_node",
          node: {
            id: "pay",
            kind: "payment",
            label: "Pay",
            position: { x: 0, y: 0 },
            config: {},
          },
        },
      ],
    ]) {
      expect(() =>
        applyWorkflowOperations(starterVisualGraph(), JSON.stringify(ops)),
      ).toThrow();
    }
  });
  it("requires a valid proposal shape and forbids hiding edits in read or publish", () => {
    expect(
      readProposal({
        action: "workflow_read",
        id: null,
        message: "",
        changes: [],
      }).action,
    ).toBe("workflow_read");
    expect(() =>
      readProposal({
        action: "workflow_publish",
        id: null,
        message: "",
        changes: [{ field: "operations", value: "[]" }],
      }),
    ).toThrow();
  });
});
