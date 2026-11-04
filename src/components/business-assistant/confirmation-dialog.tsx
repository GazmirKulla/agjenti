"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Preview } from "@/lib/business-assistant/model";
import "./confirmation-dialog.css";

/** The signed server proposal remains the only execution authority. Closing this
 * dialog preserves the proposal and conversation for corrections or reopening. */
export function ConfirmationDialog({ preview, busy, canConfirm, recovered, error, children, notice, onConfirm, onClose }: {
  preview: Preview; busy: boolean; canConfirm: boolean; recovered: boolean;
  error: string; children?: ReactNode; notice?: ReactNode; onConfirm: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  const compact = preview.fields.length <= 4 && preview.fields.every(field => field.before.length + field.after.length < 220);
  const fields = <dl>{preview.fields.map((field, index) => <div key={index}>
    <dt>{field.label}</dt><dd>{field.before !== "—" && <><span className="confirmation-before">{field.before}</span><span aria-label="bëhet"> → </span></>}{field.after}</dd>
  </div>)}</dl>;
  return <dialog id="assistant-work-detail" ref={dialog} className="assistant-confirmation" aria-labelledby={title}
    aria-busy={busy} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
    <h2 id={title}>{preview.title}</h2>
    {preview.subject && <p className="confirmation-subject">{preview.subject}</p>}
    {compact && !children ? fields : <><p>{preview.fields.length} ndryshime për shqyrtim.</p>
      <details><summary>Shiko detajet</summary>{children ?? fields}</details></>}
    {notice ?? (preview.notice && <p className="confirmation-notice">{preview.notice}</p>)}
    {recovered ? <p>Propozim i rikthyer. Rishqyrtoje në bisedë për një konfirmim të ri.</p>
      : <p className="confirmation-notice">Asgjë nuk është ruajtur ende. Konfirmimi vlen për 10 minuta.</p>}
    {error && <p role="alert" className="assistant-error">{error}</p>}
    <footer><button type="button" className="assistant-secondary" disabled={busy} onClick={onClose}>Anulo</button>
      {canConfirm && <button type="button" className="assistant-primary" disabled={busy} onClick={onConfirm}>{busy ? "Po ruhet…" : "Konfirmo"}</button>}
    </footer>
  </dialog>;
}
