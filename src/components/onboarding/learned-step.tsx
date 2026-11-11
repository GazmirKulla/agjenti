"use client";
import { useCallback, useEffect, useState } from "react";
import { SourcesReview } from "@/components/dashboard/sources-review";
import { DiscoveryScanDialog } from "@/components/setup/scan-dialog";
import type { SourcesState } from "@/lib/discovery/sources-step";
import { onboardingChannelPath } from "@/lib/onboarding/steps";
import { ProgressRows, sourceLabel } from "./sources-step";

/** Onboarding step 3: what the agent learned from the confirmed sources,
 * merged into one list the owner accepts, rejects or edits. Without sources
 * there is nothing to review and the channel comes next. */
export function LearnedStep({ slug }: { slug: string }) {
  const endpoint = `/api/business-sources?slug=${encodeURIComponent(slug)}`;
  const next = onboardingChannelPath(slug);
  const [state, setState] = useState<SourcesState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" }).catch(() => null);
    if (response?.ok) setState(await response.json());
  }, [endpoint]);
  const running = state?.scans.some((scan) => ["queued", "running"].includes(scan.status)) ?? true;
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (state && !running) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [state, running, load]);
  const nothing = !!state && !state.scans.length && !state.review;
  useEffect(() => { if (nothing) window.location.replace(next); }, [nothing, next]);

  const review = !running && state?.review ? state.review : null;
  return (
    <>
      <div className="onboarding-question">
        <span className="onboarding-eyebrow">ÇFARË MËSOI AGJENTI</span>
        <h1>{review ? "Çfarë mësoi Agjenti" : running ? "Agjenti po mbaron leximin" : "Agjenti mbaroi së lexuari"}</h1>
        <p>{review ? "Agjenti bashkoi në një listë atë që gjeti."
          : running ? "Edhe pak. Mund të vazhdosh ndërkohë dhe t'i konfirmosh më vonë nga paneli."
          : "Nuk u gjet informacion i ri për njohuritë."}</p>
      </div>
      <div className="onboarding-found">
        {review ? (
          <SourcesReview slug={slug} review={review} onDone={() => window.location.assign(next)} />
        ) : state?.scans.length ? (
          <>
            <ProgressRows rows={state.scans.map((scan) => ({ source: scan.source, label: sourceLabel[scan.source], progress: scan.progress, step: scan.step,
              state: scan.status === "completed" ? "done" : scan.status === "failed" ? "failed" : scan.id.endsWith("waiting") || (scan.status === "queued" && scan.progress <= 5) ? "waiting" : "running" }))} />
            {running && <button type="button" className="onboarding-skip" onClick={() => setDialogOpen(true)}>Shiko skanimin</button>}
          </>
        ) : (
          <div className="onboarding-learning" role="status"><span className="onboarding-spinner" aria-hidden="true" /> Duke ngarkuar…</div>
        )}
        <div className="onboarding-actions">
          <span />
          <div className="onboarding-actions-end">
            <a className={review ? "onboarding-skip" : "onboarding-next"} href={next}>{review ? "Konfirmo më vonë" : running ? "Vazhdo ndërkohë" : "Vazhdo"}</a>
          </div>
        </div>
        <DiscoveryScanDialog open={dialogOpen && running} jobs={state?.scans ?? []} startingSource="" error=""
          onClose={() => setDialogOpen(false)} onReview={() => setDialogOpen(false)} />
      </div>
    </>
  );
}
