"use client";
import { useCallback, useEffect, useState } from "react";
import { ProfileQuestions } from "@/components/dashboard/profile-questions";
import { finishOnboardingProfile } from "@/lib/onboarding/actions";
import { onboardingLearnedPath } from "@/lib/onboarding/steps";
import type { SourcesState } from "@/lib/discovery/sources-step";
import { sourceLabel } from "./sources-step";

const readingWhat = (scans: SourcesState["scans"]) => {
  const sources = new Set(scans.map((scan) => scan.source));
  return sources.has("instagram") && sources.has("website") ? "Instagram-in dhe website-in" : sources.has("instagram") ? "Instagram-in" : "website-in";
};

/** The scans of the confirmed sources, small, above the questions. */
function ScanStrip({ scans }: { scans: SourcesState["scans"] }) {
  return (
    <div className="onboarding-scan-strip" role="status" aria-live="polite">
      <span className="onboarding-scan-strip-title">Agjenti po lexon</span>
      {scans.map((scan) => {
        const done = scan.status === "completed", failed = scan.status === "failed";
        return (
          <span key={scan.id} className={`onboarding-scan-strip-item${done ? " is-done" : failed ? " is-failed" : ""}`}>
            <strong>{sourceLabel[scan.source]}</strong>
            <span className="onboarding-scan-strip-bar" aria-hidden="true"><span style={{ width: `${done ? 100 : scan.progress}%` }} /></span>
            <small>{done ? "✓ Gati" : failed ? "Nuk u lexua" : `${scan.progress}%`}</small>
          </span>
        );
      })}
    </div>
  );
}

/** Onboarding step 2: the short questions, while the confirmed Instagram and
 * website are read in the background. */
export function QuestionsStep({ slug }: { slug: string }) {
  const endpoint = `/api/business-sources?slug=${encodeURIComponent(slug)}`;
  const [state, setState] = useState<SourcesState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" }).catch(() => null);
    if (response?.ok) setState(await response.json());
  }, [endpoint]);
  const running = state?.scans.some((scan) => ["queued", "running"].includes(scan.status)) ?? true;
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (state && !running) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [state, running, load]);

  const finish = useCallback(() => {
    setLeaving(true);
    void finishOnboardingProfile(slug).catch(() => null).finally(() => window.location.assign(onboardingLearnedPath(slug)));
  }, [slug]);

  return (
    <>
      <div className="onboarding-question">
        <span className="onboarding-eyebrow">PERSONALIZO AGJENTIN</span>
        <h1>Disa pyetje të shkurtra</h1>
        <p>{state?.scans.length ? `Ndërkohë Agjenti lexon ${readingWhat(state.scans)} që konfirmove.` : "Që Agjenti të dijë si punon biznesi yt. Çdo pyetje mund ta lësh për më vonë."}</p>
      </div>
      {state && state.scans.length > 0 && <ScanStrip scans={state.scans} />}
      {leaving ? (
        <div className="onboarding-learning" role="status"><span className="onboarding-spinner" aria-hidden="true" /> Duke vazhduar…</div>
      ) : (
        <div className="onboarding-questions">
          <ProfileQuestions slug={slug} core onFinished={finish} />
        </div>
      )}
    </>
  );
}
