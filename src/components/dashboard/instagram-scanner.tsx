"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ScanFrame = {
  id: string;
  imageUrl: string | null;
  preview: string;
  found: { name: string; price: number; currency: string } | null;
};

export function InstagramScanner({
  loading,
  frames,
  onFinished,
}: {
  loading: boolean;
  frames: ScanFrame[] | null;
  onFinished: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Record<string, true>>({});
  const [reduced, setReduced] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const dialogRef = useRef<HTMLDivElement>(null);
  const count = frames?.length ?? 0;
  const stepMs = scanStepMs(count, reduced);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && count > 0) finished.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  useEffect(() => {
    setIndex(0);
    setBroken({});
  }, [frames]);

  useEffect(() => {
    if (loading || !count) return;
    if (index >= count) {
      const timer = window.setTimeout(() => finished.current(), 360);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setIndex((current) => current + 1), stepMs);
    return () => window.clearTimeout(timer);
  }, [loading, count, index, stepMs]);

  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.querySelector<HTMLElement>(`[data-scan-index="${index}"]`);
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft - strip.clientWidth / 2 + thumb.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: reduced ? "auto" : "smooth" });
  }, [index, reduced, count]);

  const shown = frames && count ? frames[Math.min(index, count - 1)] : null;
  const position = count ? Math.min(index + 1, count) : 0;
  const image = shown && !broken[shown.id] ? shown.imageUrl : null;
  const sweeping = !reduced && (loading || index < count);

  const host = document.querySelector(".dashboard-shell") ?? document.body;

  return createPortal(
    <div className="ig-scan-overlay">
    <div
      ref={dialogRef}
      className="ig-scanner"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ig-scan-title"
      aria-busy={loading || index < count}
      tabIndex={-1}
    >
      <div className="ig-scanner-head">
        <span id="ig-scan-title">Skanim</span>
        <span>{loading || !count ? "Duke marrë postimet" : `${position} / ${count}`}</span>
      </div>
      <div className="ig-scan-stage">
        {image ? (
          <img
            key={shown?.id}
            src={image}
            alt=""
            className="ig-scan-photo"
            referrerPolicy="no-referrer"
            onError={() => {
              if (!shown) return;
              setBroken((current) => ({ ...current, [shown.id]: true }));
            }}
          />
        ) : (
          <p className="ig-scan-fallback">{shown?.preview || "Po lexohen postimet e Instagram."}</p>
        )}
        <span className="ig-scan-grid" />
        <span
          key={shown?.id ?? "wait"}
          className={sweeping ? `ig-scan-beam${loading || !shown ? " is-waiting" : ""}` : "ig-scan-beam is-steady"}
          style={sweeping && shown && !loading ? { animationDuration: `${stepMs}ms` } : undefined}
        />
        <span className="ig-scan-corner is-tl" />
        <span className="ig-scan-corner is-tr" />
        <span className="ig-scan-corner is-bl" />
        <span className="ig-scan-corner is-br" />
      </div>
      <p className="ig-scan-status" aria-live="polite">
        {loading || !shown
          ? "Po merren postimet. Skanimi fillon sapo të arrijnë."
          : shown.found
            ? `U gjet: ${shown.found.name} · ${formatScanPrice(shown.found.price, shown.found.currency)}`
            : "Pa çmim në këtë postim"}
      </p>
      {count > 0 ? (
        <div className="ig-scan-strip" ref={stripRef}>
          {frames?.map((frame, frameIndex) => {
            const state =
              frameIndex === index ? "is-current" : frameIndex < index ? "is-done" : "is-ahead";
            return (
              <span
                key={frame.id}
                data-scan-index={frameIndex}
                className={`ig-scan-thumb ${state}${frame.found ? " is-product" : ""}`}
              >
                {frame.imageUrl && !broken[frame.id] ? (
                  <img
                    src={frame.imageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    onError={() => setBroken((current) => ({ ...current, [frame.id]: true }))}
                  />
                ) : (
                  <span>{frameIndex + 1}</span>
                )}
              </span>
            );
          })}
        </div>
      ) : null}
      {count > 0 ? (
        <button type="button" className="btn btn-ghost" onClick={() => finished.current()}>
          Kalo te lista
        </button>
      ) : null}
    </div>
    </div>,
    host,
  );
}

function scanStepMs(count: number, reduced: boolean): number {
  if (reduced) return 220;
  if (count <= 6) return 1200;
  if (count <= 15) return 800;
  if (count <= 30) return 520;
  return 360;
}

function formatScanPrice(price: number, currency: string): string {
  const amount = Number.isInteger(price) ? String(price) : price.toFixed(2);
  return `${amount} ${currency}`;
}
