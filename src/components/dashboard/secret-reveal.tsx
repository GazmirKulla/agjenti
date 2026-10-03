"use client";

import { useState } from "react";

export function SecretReveal({
  value,
  label = "Access token",
}: {
  value: string;
  label?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  const masked =
    value.length <= 12
      ? "••••••••"
      : `${value.slice(0, 6)}…${value.slice(-4)}`;

  return (
    <div className="secret-reveal">
      <div className="secret-reveal-label">{label}</div>
      <code className="secret-reveal-value">{visible ? value : masked}</code>
      <div className="secret-reveal-actions">
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Fshih" : "Shfaq"}
        </button>
        <button className="btn btn-ghost" type="button" onClick={copy}>
          {copied ? "Kopjuar" : "Kopjo"}
        </button>
      </div>
    </div>
  );
}
