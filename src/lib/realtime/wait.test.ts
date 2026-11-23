import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitForStoredChange } from "./wait";

afterEach(() => vi.useRealTimers());
function fixture() {
  let changed: () => void = () => {};
  let status: (value: string) => void = () => {};
  const channel = {
    on: (_kind: string, _filter: unknown, fn: () => void) => { changed = fn; return channel; },
    subscribe: (fn: (value: string) => void) => { status = fn; return channel; },
  };
  const removeChannel = vi.fn(async () => "ok");
  const db = { channel: vi.fn(() => channel), removeChannel } as unknown as SupabaseClient;
  return { db, changed: () => changed(), status: (value: string) => status(value), removeChannel };
}
it("subscribes before reading, stays idle, and takes a final deadline snapshot", async () => {
  vi.useFakeTimers();
  const f = fixture(), read = vi.fn(async () => "pending");
  const result = waitForStoredChange(f.db, "internal:test", Date.now() + 10_000, read, value => value === "done");
  expect(read).not.toHaveBeenCalled();
  f.status("SUBSCRIBED"); await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9_999); expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toBe("pending"); expect(read).toHaveBeenCalledTimes(2);
  expect(f.removeChannel).toHaveBeenCalledTimes(1);
});
it("settles on a committed change and releases the subscription and deadline", async () => {
  vi.useFakeTimers();
  const f = fixture(), read = vi.fn().mockResolvedValueOnce("pending").mockResolvedValue("done");
  const result = waitForStoredChange(f.db, "internal:test", Date.now() + 10_000, read, value => value === "done");
  f.status("SUBSCRIBED"); await vi.advanceTimersByTimeAsync(0);
  f.changed(); await vi.advanceTimersByTimeAsync(0);
  expect(await result).toBe("done");
  await vi.advanceTimersByTimeAsync(20_000);
  expect(read).toHaveBeenCalledTimes(2); expect(f.removeChannel).toHaveBeenCalledTimes(1);
});
