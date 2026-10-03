"use client";

import { startTransition, useState } from "react";

type SuggestResult = { error?: string; text?: string; success?: string };

export function AiSuggestButton({
  action,
  targetName,
  label = "Gjenero me AI",
  collect,
}: {
  action: (data: FormData) => Promise<SuggestResult>;
  targetName: string;
  label?: string;
  /** Extra field names to copy from the surrounding form into the action payload. */
  collect?: string[];
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<SuggestResult | null>(null);

  return (
    <div className="ai-suggest">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        onClick={(event) => {
          const form = event.currentTarget.closest("form");
          if (!form) {
            setMessage({ error: "Nuk u gjet forma." });
            return;
          }
          const target = form.elements.namedItem(targetName);
          if (
            !(target instanceof HTMLTextAreaElement) &&
            !(target instanceof HTMLInputElement)
          ) {
            setMessage({ error: "Fusha e synuar nuk u gjet." });
            return;
          }
          const data = new FormData();
          for (const name of collect ?? []) {
            const el = form.elements.namedItem(name);
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
              data.set(name, el.value);
            }
          }
          setPending(true);
          setMessage(null);
          startTransition(async () => {
            try {
              const result = await action(data);
              if (result.error) {
                setMessage({ error: result.error });
              } else if (result.text) {
                target.value = result.text;
                target.dispatchEvent(new Event("input", { bubbles: true }));
                setMessage({ success: result.success || "U gjenerua." });
              } else {
                setMessage({ error: "Nuk u kthye asnjë tekst." });
              }
            } catch {
              setMessage({ error: "Gjenerimi dështoi. Provo përsëri." });
            } finally {
              setPending(false);
            }
          });
        }}
      >
        {pending ? "Duke gjeneruar…" : label}
      </button>
      {message?.error ? (
        <p role="alert" className="form-feedback form-feedback-error">
          {message.error}
        </p>
      ) : message?.success ? (
        <p role="status" className="form-feedback form-feedback-success">
          {message.success}
        </p>
      ) : null}
    </div>
  );
}
