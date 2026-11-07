import { expect, it } from "vitest";
import { initialSnapshot } from "./contracts";
import { readStoredConversationState } from "./stored-state";
const scope = { businessId: "business", conversationId: "conversation", revision: 3 };
it("preserves the authoritative snapshot on reload without copying facts into legacy fields", () => {
  const snapshot = { ...initialSnapshot(scope.businessId, scope.conversationId, "live"), revision: 3 };
  const state = readStoredConversationState(snapshot, scope);
  expect(state.runtime).toEqual(snapshot);
  expect(state.runtime).not.toBe(snapshot);
  expect(state.fields).toEqual({});
});
it("rejects leftover v3 snapshots instead of projecting them as an empty conversation", () => {
  expect(() => readStoredConversationState({ schemaVersion: 3, fields: {}, customer: {} }, scope)).toThrow("unsupported_stored_state");
});
it.each(["business", "conversation", "revision", "mode", "future"])("rejects a %s mismatch instead of restarting the conversation", mismatch => {
  const snapshot = { ...initialSnapshot(scope.businessId, scope.conversationId, "live"), revision: 3 };
  const invalid = { ...snapshot, ...(mismatch === "business" ? { businessId: "foreign" } : mismatch === "conversation" ? { conversationId: "foreign" }
    : mismatch === "revision" ? { revision: 4 } : mismatch === "mode" ? { mode: "test" } : { schemaVersion: 5 }) };
  expect(() => readStoredConversationState(invalid, scope)).toThrow();
});
