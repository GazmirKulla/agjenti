"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./modal.css";

/**
 * The app's one modal (same split as the mobile app and Zana Store):
 * - `sm`: a centred card for confirmations and short choices.
 * - `md`: a centred dialog for forms and details; a bottom sheet on phones.
 * - `lg`: a wide, tall panel for long flows; full screen on phones.
 * The header (back, title, close) and the footer stay fixed; only the body scrolls.
 * Content deeper in the tree puts its actions in the footer with `<ModalFooter>`.
 */
export type ModalSize = "sm" | "md" | "lg";

const FooterSlot = createContext<HTMLElement | null>(null);

let locks = 0;
let previousOverflow = "";
function lockScroll() {
  if (locks++ === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  return () => {
    if (--locks === 0) document.body.style.overflow = previousOverflow;
  };
}

export function Modal({
  open = true,
  onClose,
  size = "md",
  title,
  subtitle,
  onBack,
  headerExtra,
  footer,
  dismissible = true,
  closeLabel = "Mbyll",
  backLabel = "Kthehu",
  className,
  bodyClassName,
  describedBy,
  id,
  children,
}: {
  /** Defaults to true for modals that are mounted only while open. */
  open?: boolean;
  onClose: () => void;
  size?: ModalSize;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Shows a back arrow before the title. */
  onBack?: () => void;
  /** Extra controls in the header, before the close button. */
  headerExtra?: ReactNode;
  /** Actions pinned under the body. */
  footer?: ReactNode;
  /** False while busy: Escape, the backdrop and the close button do nothing. */
  dismissible?: boolean;
  closeLabel?: string;
  backLabel?: string;
  className?: string;
  bodyClassName?: string;
  describedBy?: string;
  id?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  const latest = useRef({ open, onClose, dismissible });
  useEffect(() => {
    latest.current = { open, onClose, dismissible };
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const unlock = lockScroll();
    return () => {
      unlock();
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  const close = () => {
    if (dismissible) onClose();
  };

  return (
    <dialog
      ref={ref}
      id={id}
      className={["modal", `modal-${size}`, className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onKeyDown={(event) => {
        // Escape belongs to the top modal, not the page or a parent modal under it.
        if (event.key === "Escape") event.stopPropagation();
      }}
      onClose={(event) => {
        // Closed natively (e.g. a <form method="dialog">) while the parent still shows it.
        // A parent that re-shows its child modals (the assistant panel) has reopened it by now.
        if (latest.current.open && !event.currentTarget.open) latest.current.onClose();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside) close();
      }}
    >
      {open ? (
        <>
          <header className="modal-header">
            {onBack ? (
              <button type="button" className="modal-icon-button" aria-label={backLabel} onClick={onBack}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
              </button>
            ) : null}
            <div className="modal-heading">
              <h2 id={titleId}>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            {headerExtra}
            <button type="button" className="modal-icon-button" aria-label={closeLabel} disabled={!dismissible} onClick={close}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div className={["modal-body", bodyClassName].filter(Boolean).join(" ")}>
            <FooterSlot.Provider value={footerEl}>{children}</FooterSlot.Provider>
          </div>
          <footer ref={setFooterEl} className="modal-footer">{footer}</footer>
        </>
      ) : null}
    </dialog>
  );
}

/** Renders its children in the enclosing Modal's fixed footer; outside a modal, in place. */
export function ModalFooter({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlot);
  return slot ? createPortal(children, slot) : <div className="modal-footer-inline">{children}</div>;
}
