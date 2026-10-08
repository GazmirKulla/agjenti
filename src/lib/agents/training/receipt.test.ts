import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { issueTrainingReceipt, readTrainingReceipt } from "./receipt";
import { readTestSession, snapshotTestSession } from "../test-chat/session";
beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64)));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it("binds feedback to the real turn, user, business, and purpose", () => {
  const token = issueTrainingReceipt("owner", "business", "Pyetje", "Përgjigje", "workflow", "step");
  expect(readTrainingReceipt(token, "owner", "business")).toMatchObject({ question: "Pyetje", response: "Përgjigje", workflowId: "workflow", stepKey: "step" });
  expect(() => readTrainingReceipt(token, "other", "business")).toThrow();
  expect(() => readTrainingReceipt(token, "owner", "other")).toThrow();
  expect(() => readTrainingReceipt(token + "x", "owner", "business")).toThrow();
  expect(() => readTrainingReceipt(snapshotTestSession(readTestSession(null, "owner", "business")), "owner", "business")).toThrow();
  expect(() => readTestSession(token, "owner", "business")).toThrow();
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 3600001);
  expect(() => readTrainingReceipt(token, "owner", "business")).toThrow();
});
