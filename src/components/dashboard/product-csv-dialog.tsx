"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./icon";

export function ProductCsvDialog({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = dialog?.closest(".csv-import");
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
      else container?.querySelector<HTMLElement>("button:not(:disabled), a[href]")?.focus();
    };
  }, []);
  return <dialog ref={ref} className="csv-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
    onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" className="csv-icon-button" aria-label="Mbyll detajet e CSV-së" onClick={onClose}><Icon name="close" size={20}/></button></header>
    <div className="csv-dialog-content">{children}</div>
    {footer && <footer>{footer}</footer>}
  </dialog>;
}
