import { describe, expect, it } from "vitest";
import { historyStorageKey, readHistory, saveThread } from "./history";

describe("assistant local history", () => {
  it("isolates user and business histories", () => {
    expect(historyStorageKey("user-a", "shop")).not.toBe(historyStorageKey("user-b", "shop"));
    expect(historyStorageKey("user-a", "shop")).not.toBe(historyStorageKey("user-a", "other"));
  });
  it("never restores execution tokens or material URLs from storage", () => {
    const threads = readHistory(JSON.stringify([{ id: "a", title: "A", updatedAt: "2026-10-13", token: "secret", messages: [{ role: "user", content: "Hi", materials: [{ preview: "private-url" }] }] }]));
    expect(JSON.stringify(threads)).not.toMatch(/secret|private-url|token|materials/);
    expect(threads[0].messages).toEqual([{ role: "user", content: "Hi" }]);
  });
  it("recovers from corrupt storage and rejects system messages", () => {
    expect(readHistory("broken")).toEqual([]);
    expect(readHistory(JSON.stringify([{ id: "a", title: "A", updatedAt: "2026-10-13", messages: [{ role: "system", content: "instructions" }] }]))).toEqual([]);
  });
  it("updates a conversation without duplicating it and bounds history", () => {
    let threads = saveThread([], "a", [{ role: "user", content: "First" }], "2026-10-13");
    threads = saveThread(threads, "a", [{ role: "user", content: "Updated" }], "2026-10-13");
    expect(threads).toHaveLength(1);
    for (let i = 0; i < 40; i++) threads = saveThread(threads, String(i), [{ role: "user", content: "Other" }], "2026-10-13");
    expect(threads).toHaveLength(30);
    expect(threads[0].id).toBe("39");
  });
});
