"use client";

import type { ReactNode } from "react";
import type { Preview } from "@/lib/business-assistant/model";
import { Modal } from "@/components/modal/modal";
import "./confirmation-dialog.css";

/** The signed server proposal remains the only execution authority. Closing this
 * dialog preserves the proposal and conversation for corrections or reopening. */
export function ConfirmationDialog({ preview, busy, canConfirm, recovered, error, children, notice, onConfirm, onClose }: {
  preview: Preview; busy: boolean; canConfirm: boolean; recovered: boolean;
  error: string; children?: ReactNode; notice?: ReactNode; onConfirm: () => void; onClose: () => void;
}) {
  const compact = preview.fields.length <= 4 && preview.fields.every(field => field.before.length + field.after.length < 220);
  const fields = <dl>{preview.fields.map((field, index) => <div key={index}>
    <dt>{field.label}</dt><dd>{field.before !== "—" && <><span className="confirmation-before">{field.before}</span><span aria-label="bëhet"> → </span></>}{field.after}</dd>
  </div>)}</dl>;
  return <Modal id="assistant-work-detail" size="md" className="assistant-confirmation" title={preview.title} subtitle={preview.subject || undefined}
    onClose={onClose} dismissible={!busy}
    footer={<>
      <button type="button" className="assistant-secondary" disabled={busy} onClick={onClose}>{preview.configuration ? "Refuzo" : "Anulo"}</button>
      {canConfirm && <button type="button" className="assistant-primary" disabled={busy} onClick={onConfirm}>{busy ? "Po zbatohet…" : preview.configuration ? "Prano ndryshimin" : "Konfirmo"}</button>}
    </>}>
    <div aria-busy={busy}>
      {compact && !children ? fields : <><p>{preview.fields.length} ndryshime për shqyrtim.</p>
        <details><summary>Shiko detajet</summary>{children ?? fields}</details></>}
      {notice ?? (preview.notice && <p className="confirmation-notice">{preview.notice}</p>)}
      {recovered ? <p>Propozim i rikthyer. Rishqyrtoje në bisedë për një konfirmim të ri.</p>
        : <p className="confirmation-notice">Konfirmimi vlen për ndryshimet e paraqitura, për 10 minuta.</p>}
      {error && <p role="alert" className="assistant-error">{error}</p>}
    </div>
  </Modal>;
}
