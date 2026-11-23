import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidationTask, parseChange, matchesChange } from "./invalidation";
afterEach(() => vi.useRealTimers());
describe("event driven invalidation", () => {
  it("ignores changes for another business but always reconciles access and reconnects",()=>{
    expect(matchesChange({resource:"inbox",slug:"other"},["inbox"],"current")).toBe(false);
    expect(matchesChange({resource:"inbox",slug:"current"},["inbox"],"current")).toBe(true);
    expect(matchesChange({resource:"access",slug:"other"},["inbox"],"current")).toBe(true);
    expect(matchesChange(null,["inbox"],"current")).toBe(true);
  });
  it("does no work while idle, coalesces a burst and never repeats a settled read", async () => {
    vi.useFakeTimers(); const read = vi.fn(async () => {});
    const task = invalidationTask(read, () => true);
    await vi.advanceTimersByTimeAsync(600_000); expect(read).not.toHaveBeenCalled();
    for (let i=0;i<100;i++) task.invalidate();
    await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600_000); expect(read).toHaveBeenCalledTimes(1); task.stop();
  });
  it("does not lose an event arriving during a read", async () => {
    vi.useFakeTimers(); let resolve!: () => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<void>(r => { resolve=r; })).mockResolvedValue(undefined);
    const task = invalidationTask(read, () => true); task.invalidate();
    await vi.advanceTimersByTimeAsync(100); task.invalidate(); task.invalidate();
    resolve(); await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2); task.stop();
  });
  it("waits for foreground and suppresses callbacks after disposal", async () => {
    vi.useFakeTimers(); let visible=false; const read=vi.fn(async () => {});
    const task=invalidationTask(read,()=>visible); task.invalidate();
    await vi.advanceTimersByTimeAsync(600_000); expect(read).not.toHaveBeenCalled();
    visible=true; task.invalidate(); await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledTimes(1);
    task.invalidate(); task.stop(); await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledTimes(1);
  });
  it("does not silently poll after a failed read", async () => {
    vi.useFakeTimers(); const read=vi.fn().mockRejectedValue(new Error("offline"));
    const task=invalidationTask(read,()=>true); task.invalidate(); await vi.advanceTimersByTimeAsync(600_000);
    expect(read).toHaveBeenCalledTimes(1); task.invalidate(); await vi.advanceTimersByTimeAsync(100); expect(read).toHaveBeenCalledTimes(2); task.stop();
  });
  it("validates hints without carrying payload data into the application",()=>{
    expect(parseChange({ resource:"inbox", body:"untrusted", businessId:"foreign" })).toEqual({resource:"inbox"});
    expect(parseChange({resource:"execute"})).toBeNull(); expect(parseChange(null)).toBeNull();
  });
});
