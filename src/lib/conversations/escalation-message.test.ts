import { expect, it } from "vitest";
import { escalationMessage } from "./escalation-message";

const turn = [{ id: "m1", text: "Përshëndetje" }, { id: "m2", text: "Ju thashë   tre herë, nuk po më ndihmoni fare!" }, { id: "m3", text: "ok" }];

it("points at the message that holds the customer's quoted words, whatever their spacing or case", () => {
  expect(escalationMessage(turn, "nuk po më NDIHMONI fare")).toBe("m2");
  expect(escalationMessage(turn, "Ju thashë tre herë")).toBe("m2");
});

it("falls back to the turn's latest message without a quote that fits one message, and to nothing without messages", () => {
  expect(escalationMessage(turn, undefined)).toBe("m3");
  expect(escalationMessage(turn, "fare! ok")).toBe("m3");
  expect(escalationMessage([], "fare")).toBeNull();
});
