"use client";
import { useState, useTransition } from "react";
import { payWithPok } from "@/lib/billing/actions";

/** Opens POK's own payment page for the chosen plan; POK sends the payer back here afterwards. */
export function PokPayButton({ slug, plan, label, quiet = false }: { slug: string; plan: string; label: string; quiet?: boolean }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
    <button type="button" className={quiet ? "btn btn-ghost" : "btn btn-primary"} disabled={pending} onClick={() => start(async () => {
      setError("");
      const result = await payWithPok(slug, plan);
      if (result?.error) setError(result.error);
    })}>{pending ? "Po hapet POK…" : label}</button>
    {error && <p className="form-feedback form-feedback-error" role="alert">{error}</p>}
  </div>;
}
