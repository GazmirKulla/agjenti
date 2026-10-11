"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icon";
import styles from "./integration-card.module.css";

export function IntegrationDetailsDialog({ slug, name, children }: { slug: string; name: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const close = () => router.replace(`/b/${slug}/integrations`, { scroll: false });
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    } }}>
    <header className={styles.dialogHeader}><h2 id={titleId}>{name} · Detajet</h2>
      <button type="button" className={styles.dialogClose} aria-label="Mbyll detajet" onClick={close}><Icon name="close" size={20} /></button>
    </header>
    <div className={styles.dialogContent}>{children}</div>
  </dialog>;
}
