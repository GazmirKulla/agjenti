"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function DeleteBusinessPanel(props: {
  businessId: string;
  slug: string;
  businessName: string;
  redirectTo?: string;
  /** Use inside an existing panel (e.g. admin detail). */
  embedded?: boolean;
}) {
  const router = useRouter();
  const [confirmSlug, setConfirmSlug] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit =
    confirmSlug.trim().toLowerCase() === props.slug && !pending;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    if (
      !window.confirm(
        `Fshi përgjithmonë biznesin “${props.businessName}”? Të gjitha bisedat, porositë, produktet dhe lidhjet hiqen. Ky veprim nuk kthehet mbrapsht.`,
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/businesses/${props.businessId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmSlug: confirmSlug.trim().toLowerCase() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Biznesi nuk u fshi.");
      router.push(props.redirectTo ?? "/auth/continue");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Lidhja dështoi. Provo përsëri.",
      );
      setPending(false);
    }
  }

  const body = (
    <>
      <h2 className="text-base mb-3">Zona e rrezikshme</h2>
      <p className="muted-copy mb-5">
        Fshirja e biznesit heq përgjithmonë bisedat, mesazhet, porositë,
        produktet, agjentët dhe lidhjen me Instagram. Llogaritë e përdoruesve
        mbeten.
      </p>
      <form className="grid gap-4" onSubmit={onSubmit}>
        <label className="form-label">
          Shkruaj <strong>{props.slug}</strong> për të konfirmuar
          <input
            className="field"
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
            placeholder={props.slug}
            autoComplete="off"
            disabled={pending}
            required
          />
        </label>
        <button
          className="btn btn-ghost text-danger"
          type="submit"
          disabled={!canSubmit}
        >
          {pending ? "Duke fshirë…" : "Fshi biznesin përgjithmonë"}
        </button>
        {error && (
          <p role="alert" className="form-feedback form-feedback-error">
            {error}
          </p>
        )}
      </form>
    </>
  );

  if (props.embedded) {
    return <div className="detail-block danger-zone">{body}</div>;
  }
  return <section className="panel section-pad danger-zone">{body}</section>;
}
