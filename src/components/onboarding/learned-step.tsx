"use client";
import { subscribeChanges } from "@/lib/realtime/browser";
import { useCallback, useEffect, useState } from "react";
import { SourcesReview } from "@/components/dashboard/sources-review";
import { DiscoveryScanDialog } from "@/components/setup/scan-dialog";
import type { SourcesState } from "@/lib/discovery/sources-step";
import { onboardingChannelPath } from "@/lib/onboarding/steps";
import { ProfileReview } from "./profile-review";
import { ProductStructureStep } from "./product-structure-step";
import { ProgressRows, sourceLabel } from "./sources-step";

const isRunning = (state: SourcesState | null) => state?.scans.some((scan) => ["queued", "running"].includes(scan.status)) ?? true;

/** Onboarding step 3: the scan of the confirmed sources goes on, shown large
 * (the owner can minimize it); then what it found, merged into one list to
 * accept, reject or edit; then the profile questions prefilled from it.
 * Without sources the channel comes next. */
export function LearnedStep({ slug }: { slug: string }) {
  const endpoint = `/api/business-sources?slug=${encodeURIComponent(slug)}`;
  const next = onboardingChannelPath(slug);
  const [state, setState] = useState<SourcesState | null>(null);
  // The scan is shown large when the step opens, running or already finished
  // ("Gati" with its count); the owner minimizes it or moves on from it.
  const [dialogOpen, setDialogOpen] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // After the profile (or with no scan at all): the products' structure, then the channel step.
  const [structureStep, setStructureStep] = useState(false);
  const goNext = useCallback(() => window.location.assign(next), [next]);
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const data = await response.json() as SourcesState;
    setState(data);
    setDialogOpen((open) => open ?? data.scans.length > 0);
  }, [endpoint]);
  const running = isRunning(state);
  useEffect(() => { void load(); }, [load, slug]);
  useEffect(() => {
    const unsubscribe = subscribeChanges(["discovery"], load, false, slug);
    return () => unsubscribe();
  }, [load, slug]);
  const nothing = !!state && !state.scans.length && !state.review;
  useEffect(() => { if (nothing) setStructureStep(true); }, [nothing]);

  // After the review (or when it was done earlier), the profile prefilled from the scan.
  const profile = confirmed || (!!state && !running && !state.review && state.scans.length > 0);
  const review = !running && !profile && state?.review ? state.review : null;
  return (
    <>
      <div className="onboarding-question">
        <span className="onboarding-eyebrow">ÇFARË MËSOI AGJENTI</span>
        <h1>{structureStep ? "Struktura e produkteve" : profile ? "Profili i biznesit" : review ? "Çfarë mësoi Agjenti" : running ? "Agjenti po lexon faqet" : "Agjenti mbaroi së lexuari"}</h1>
        <p>{structureStep || profile ? ""
          : review ? "Agjenti bashkoi në një listë atë që gjeti."
          : running ? "Edhe pak. Mund ta zvogëlosh pamjen dhe të vazhdosh ndërkohë; i konfirmon më vonë nga paneli."
          : ""}</p>
      </div>
      <div className="onboarding-found">
        {structureStep ? (
          <ProductStructureStep slug={slug} onDone={goNext} />
        ) : profile ? (
          <ProfileReview slug={slug} onDone={() => setStructureStep(true)} />
        ) : review ? (
          <SourcesReview slug={slug} review={review} onDone={() => setConfirmed(true)} />
        ) : state?.scans.length ? (
          <>
            <ProgressRows rows={state.scans.map((scan) => ({ source: scan.source, label: sourceLabel[scan.source], progress: scan.progress, step: scan.step,
              state: scan.status === "completed" ? "done" : scan.status === "failed" ? "failed" : scan.id.endsWith("waiting") || (scan.status === "queued" && scan.progress <= 5) ? "waiting" : "running" }))} />
            <button type="button" className="onboarding-skip" onClick={() => setDialogOpen(true)}>Shiko skanimin</button>
          </>
        ) : (
          <div className="onboarding-learning" role="status"><span className="onboarding-spinner" aria-hidden="true" /> Duke ngarkuar…</div>
        )}
        {!profile && !structureStep && (
          <div className="onboarding-actions">
            <span />
            <div className="onboarding-actions-end">
              <a className={review ? "onboarding-skip" : "onboarding-next"} href={next}>{review ? "Konfirmo më vonë" : running ? "Vazhdo ndërkohë" : "Vazhdo"}</a>
            </div>
          </div>
        )}
        <DiscoveryScanDialog open={!!dialogOpen && !!state?.scans.length && !confirmed} jobs={state?.scans ?? []} startingSource="" error=""
          onClose={() => setDialogOpen(false)} onReview={() => setDialogOpen(false)} />
      </div>
    </>
  );
}
