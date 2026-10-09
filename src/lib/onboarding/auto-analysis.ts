export const AUTO_ANALYSIS_SECONDS = 8;

/** A recording gets one automatic attempt; cancellation also disables runNow. */
export function scheduleAudioAnalysis(
  onAnalyze: () => void,
  onCountdown: (seconds: number) => void,
) {
  let remaining = AUTO_ANALYSIS_SECONDS;
  let active = true;
  const timer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) runNow();
    else onCountdown(remaining);
  }, 1000);
  function cancel() {
    active = false;
    clearInterval(timer);
  }
  function runNow() {
    if (!active) return;
    cancel();
    onAnalyze();
  }
  onCountdown(remaining);
  return { cancel, runNow };
}
