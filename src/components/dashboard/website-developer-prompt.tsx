"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "./icon";

export function WebsiteDeveloperPrompt({ prompt }: { prompt: string }) {
  const id = useId();
  const preview = useRef<HTMLDetailsElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");

  async function copy() {
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("copied");
    } catch {
      setStatus("failed");
      if (preview.current) preview.current.open = true;
      text.current?.focus();
      text.current?.select();
    }
  }

  return <section className="grid gap-3" aria-labelledby={`${id}-title`}>
    <div className="section-title">
      <h2 id={`${id}-title`}>1. Përgatit webin</h2>
      <button type="button" className="btn btn-ghost" disabled={status === "copying"} onClick={copy}>
        <Icon name="copy" size={18} />{status === "copying" ? "Duke kopjuar…" : "Kopjo promptin"}
      </button>
    </div>
    <p className="muted-copy">Dërgoja promptin developerit. Ai do të përgatisë webin dhe të japë adresat e lidhjes.</p>
    <details ref={preview}>
      <summary>Shiko promptin</summary>
      <label className="form-label mt-3" htmlFor={`${id}-text`}>Prompti i plotë</label>
      <textarea ref={text} id={`${id}-text`} className="field w-full" rows={16} readOnly value={prompt} />
    </details>
    <p role="status" aria-live="polite" className="muted-copy" hidden={status !== "copied" && status !== "failed"}>
      {status === "copied" ? "Prompti u kopjua. Dërgoja developerit të webit." : status === "failed" ? "Kopjimi automatik dështoi. Hap «Shiko promptin» dhe kopjo tekstin manualisht." : ""}
    </p>
  </section>;
}
