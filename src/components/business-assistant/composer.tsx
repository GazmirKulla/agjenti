"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/dashboard/icon";
import "./composer.css";

export function AssistantComposer({ id, value, onChange, onSubmit, onVoice, onOpen, placeholder = "Pyet ose kërko një ndryshim…", busy = false, multiline = false }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onVoice: () => void;
  onOpen?: () => void;
  placeholder?: string;
  busy?: boolean;
  multiline?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 144)}px`;
  }, [value]);
  const canSend = !busy && value.trim().length >= 3;
  return (
    <form className={`assistant-prompt ${multiline ? "is-multiline" : ""}`} onSubmit={event => { event.preventDefault(); if (canSend) onSubmit(); }} aria-busy={busy}>
      {onOpen && <button type="button" onClick={onOpen} aria-label="Hap bisedën me Agjentin" title="Hap bisedën"><Icon name="inbox" size={20} /></button>}
      <label className="sr-only" htmlFor={id}>Shkruaji Agjentit</label>
      {multiline ? <textarea ref={textarea} id={id} value={value} onChange={event => onChange(event.target.value)} rows={1} maxLength={12000} placeholder={placeholder} disabled={busy}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canSend) onSubmit(); } }} />
        : <input id={id} value={value} onChange={event => onChange(event.target.value)} maxLength={12000} placeholder={placeholder} disabled={busy} autoComplete="off" />}
      <div className="assistant-prompt-actions">
        <button type="button" className="assistant-prompt-voice" onClick={onVoice} disabled={busy} aria-label="Fol me Agjentin" title="Fol me Agjentin"><Icon name="microphone" size={21} /></button>
        <button type="submit" className="assistant-prompt-send" disabled={!canSend} aria-label={busy ? "Duke përgatitur përgjigjen" : "Dërgo mesazhin"} title="Dërgo mesazhin">
          {busy ? <span className="assistant-prompt-spinner" aria-hidden="true" /> : <Icon name="arrow" size={21} style={{ transform: "rotate(-90deg)" }} />}
        </button>
      </div>
    </form>
  );
}
