import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_ANALYSIS_SECONDS, scheduleAudioAnalysis } from "./auto-analysis";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("automatic audio analysis", () => {
  it("shows a countdown and starts exactly once after the grace period", () => {
    const analyze = vi.fn();
    const countdown = vi.fn();
    scheduleAudioAnalysis(analyze, countdown);
    expect(countdown).toHaveBeenLastCalledWith(AUTO_ANALYSIS_SECONDS);
    vi.advanceTimersByTime(7000);
    expect(countdown).toHaveBeenLastCalledWith(1);
    expect(analyze).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(analyze).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("manual analysis cancels the deadline and cannot double-submit", () => {
    const analyze = vi.fn();
    const task = scheduleAudioAnalysis(analyze, vi.fn());
    vi.advanceTimersByTime(7900);
    task.runNow();
    task.runNow();
    vi.advanceTimersByTime(20000);
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("cancels when recording again, leaving the page or starting playback", () => {
    const analyze = vi.fn();
    const countdown = vi.fn();
    const task = scheduleAudioAnalysis(analyze, countdown);
    vi.advanceTimersByTime(7000);
    task.cancel();
    countdown.mockClear();
    vi.advanceTimersByTime(20000);
    task.runNow();
    expect(analyze).not.toHaveBeenCalled();
    expect(countdown).not.toHaveBeenCalled();
  });

  it("gives a new recording or finished playback a fresh countdown", () => {
    const first = vi.fn();
    const next = vi.fn();
    const task = scheduleAudioAnalysis(first, vi.fn());
    vi.advanceTimersByTime(6000);
    task.cancel();
    scheduleAudioAnalysis(next, vi.fn());
    vi.advanceTimersByTime(7000);
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
