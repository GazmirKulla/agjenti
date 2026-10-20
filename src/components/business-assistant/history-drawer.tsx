"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { StoredConversation } from "@/lib/business-assistant/persistence-model";
import "./history-drawer.css";

type Props = {
  open: boolean; mobile: boolean; assistantName: string; businessName: string;
  threads: StoredConversation[]; selectedId?: string; busy: boolean; loading: boolean; warning: string;
  onClose: () => void; onSelect: (thread: StoredConversation) => void; onNew: () => void;
  onRename: (thread: StoredConversation, title: string) => Promise<boolean>;
  onDelete: (thread: StoredConversation) => Promise<boolean>; onMore?: () => void;
};

function ConversationRow({ thread, selected, busy, onSelect, onRename, onDelete }: Pick<Props, "busy" | "onSelect" | "onRename" | "onDelete"> & { thread: StoredConversation; selected: boolean }) {
  const [mode, setMode] = useState<"menu" | "rename" | "delete" | null>(null);
  const [title, setTitle] = useState(thread.title);
  const [saving, setSaving] = useState(false);
  const root = useRef<HTMLLIElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => { setMode(null); trigger.current?.focus(); };
  useEffect(() => {
    if (!mode) return;
    root.current?.querySelector<HTMLElement>(mode === "menu" ? '[role="menuitem"]' : mode === "rename" ? "input" : '[data-cancel]')?.focus();
    const outside = (event: PointerEvent) => {
      if (mode === "menu" && !root.current?.contains(event.target as Node)) setMode(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [mode]);
  const disabled = busy || saving;
  return <li ref={root} className="assistant-history-row" onKeyDown={event => {
    if (event.key === "Escape" && mode) { event.preventDefault(); event.stopPropagation(); if (!saving) close(); }
  }}>
    <div className="assistant-history-row-main">
      <button className="assistant-history-select" type="button" disabled={disabled} aria-current={selected ? "true" : undefined} onClick={() => onSelect(thread)}>
        <strong>{thread.title}</strong>
        <small>{new Date(thread.updated_at).toLocaleDateString("sq-AL", { day: "numeric", month: "short" })}</small>
      </button>
      <button ref={trigger} type="button" className="assistant-history-options" disabled={disabled} aria-label={`Veprime për ${thread.title}`} aria-haspopup="menu" aria-expanded={mode === "menu"} aria-controls={id}
        onClick={() => setMode(mode === "menu" ? null : "menu")} onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMode("menu"); }
        }}>•••</button>
    </div>
    {mode === "menu" && <div id={id} role="menu" aria-label={`Veprime për ${thread.title}`} className="assistant-history-menu" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setMode(null);
    }} onKeyDown={event => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const index = items.indexOf(document.activeElement as HTMLElement);
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
    }}>
      <button role="menuitem" type="button" onClick={() => { setTitle(thread.title); setMode("rename"); }}>Riemërto</button>
      <button role="menuitem" type="button" onClick={() => setMode("delete")}>Fshi</button>
    </div>}
    {mode === "rename" && <form className="assistant-history-edit" onSubmit={async event => {
      event.preventDefault(); if (disabled) return;
      setSaving(true); try { if (await onRename(thread, title.trim())) close(); } finally { setSaving(false); }
    }}>
      <label htmlFor={`${id}-title`}>Titulli i bisedës</label>
      <input id={`${id}-title`} value={title} onChange={event => setTitle(event.target.value)} maxLength={100} required disabled={disabled}/>
      <div><button type="submit" disabled={disabled || !title.trim()}>Ruaj</button><button type="button" disabled={saving} onClick={close}>Anulo</button></div>
    </form>}
    {mode === "delete" && <div className="assistant-history-edit" role="group" aria-label={`Fshi ${thread.title}`}>
      <p>Fshi përgjithmonë mesazhet dhe planet? Veprimet e kryera në biznes nuk zhbëhen.</p>
      <div><button type="button" data-cancel disabled={saving} onClick={close}>Anulo</button><button type="button" disabled={disabled} onClick={async () => {
        const back = root.current?.closest("aside")?.querySelector<HTMLButtonElement>('[aria-label="Mbyll historikun"]');
        setSaving(true);
        try { if (await onDelete(thread)) back?.focus(); }
        finally { setSaving(false); }
      }}>Fshi përgjithmonë</button></div>
    </div>}
  </li>;
}

/** Presentation only. The existing UX-3 hook remains the sole history owner. */
export function AssistantHistoryDrawer(props: Props) {
  const { open, mobile, assistantName, businessName, threads, selectedId, busy, loading, warning, onClose, onSelect, onNew, onRename, onDelete, onMore } = props;
  const root = useRef<HTMLElement>(null), closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>("button")?.focus());
    const outside = (event: PointerEvent) => {
      if (!mobile && !root.current?.contains(event.target as Node) && event.target !== trigger) closeRef.current();
    };
    document.addEventListener("pointerdown", outside);
    // Only the mobile drawer is modal. Reuse the same assistant surface, not a nested dialog.
    const inert: { element: HTMLElement; previous: boolean }[] = [];
    const overflow = document.body.style.overflow;
    if (mobile) {
      let branch: HTMLElement | null = root.current;
      while (branch?.parentElement) {
        for (const sibling of branch.parentElement.children) if (sibling !== branch && sibling instanceof HTMLElement) {
          inert.push({ element: sibling, previous: sibling.inert }); sibling.inert = true;
        }
        branch = branch.parentElement;
        if (branch === document.body) break;
      }
      document.body.style.overflow = "hidden";
    }
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside);
      for (const { element, previous } of inert) element.inert = previous;
      if (mobile) document.body.style.overflow = overflow;
      if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus({ preventScroll: true });
    };
  }, [open, mobile]);
  if (!open) return null;
  return <aside ref={root} id="assistant-history" className="assistant-history-drawer" role={mobile ? "dialog" : "complementary"} aria-modal={mobile || undefined} aria-labelledby={`${id}-title`}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab" && mobile) {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled)"));
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
    <header><div><h2 id={`${id}-title`}>Bisedat me {assistantName}</h2><p>Private · {businessName}</p></div><button type="button" onClick={onClose} aria-label="Mbyll historikun" title="Kthehu te biseda">←</button></header>
    <button type="button" className="assistant-primary" disabled={busy} onClick={onNew}><span aria-hidden>+ </span>Bisedë e re</button>
    {warning && <p role="alert">{warning}</p>}
    {loading && <p role="status">Po ngarkohen bisedat…</p>}
    <nav aria-label="Bisedat private" aria-busy={loading} className="assistant-history-scroll">
      <ul>{threads.map(thread => <ConversationRow key={thread.id} thread={thread} selected={thread.id === selectedId} busy={busy} onSelect={onSelect} onRename={onRename} onDelete={onDelete}/>)}</ul>
      {!threads.length && !loading && !warning && <p>Bisedat e tua shfaqen këtu pasi dërgon një mesazh. Historiku i klientëve mbetet te Bisedat.</p>}
      {onMore && <button type="button" disabled={busy || loading} onClick={onMore}>Më shumë biseda</button>}
    </nav>
    <small className="assistant-history-note">Hapja e një bisede nuk ekzekuton veprime.</small>
  </aside>;
}
