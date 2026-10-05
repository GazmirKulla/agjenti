"use client";
import type { Source } from "@/lib/business-intelligence/model";
export function IntelligenceTrigger({
  source = "audio",
  children,
}: {
  source?: Source;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("business-intelligence:open", { detail: { source } }),
        )
      }
    >
      {children}
    </button>
  );
}
