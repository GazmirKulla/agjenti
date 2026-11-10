"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLeadStatus } from "@/lib/leads/actions";
import { statusLabels, type LeadStatus } from "@/lib/leads/model";

/** The next steps for one lead; the current status is shown, not offered. */
export function LeadStatusButtons({ slug, leadId, status }: { slug: string; leadId: string; status: LeadStatus }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const next: LeadStatus[] = status === "new" ? ["contacted", "won", "lost"]
    : status === "contacted" ? ["won", "lost"] : ["contacted"];
  const run = (target: LeadStatus) => start(async () => {
    const result = await updateLeadStatus(slug, leadId, target);
    setError(result.error ?? "");
    if (!result.error) router.refresh();
  });
  return (
    <div className="lead-actions">
      {next.map((target) => (
        <button key={target} type="button" className={`btn btn-ghost lead-action lead-action-${target}`} disabled={pending} onClick={() => run(target)}>
          {status === "won" || status === "lost" ? "Rihap" : statusLabels[target]}
        </button>
      ))}
      {error && <p role="alert" className="lead-error">{error}</p>}
    </div>
  );
}
