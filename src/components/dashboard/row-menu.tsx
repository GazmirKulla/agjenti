"use client";
import Link from "next/link";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./row-menu.css";

export type RowMenuItem = {
  label: string; href?: string; onSelect?: () => void; danger?: boolean; disabled?: boolean;
  /** Renders as a radio choice; items sharing `group` are shown under that heading. */
  checked?: boolean; group?: string;
};

const ENTRY = "[role^=menuitem]:not([aria-disabled=true])";

/** "More options" menu: a dropdown on wide screens, a bottom sheet on phones. */
export function RowMenu({ label, title, items, trigger: face, triggerClassName }: {
  label: string; title?: string; items: RowMenuItem[]; trigger?: React.ReactNode; triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<React.CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const list = sheet.current;
    (list?.querySelector<HTMLElement>(`${ENTRY}[aria-checked=true]`) ?? list?.querySelector<HTMLElement>(ENTRY))?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !sheet.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); return; }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const entries = [...(sheet.current?.querySelectorAll<HTMLElement>(ENTRY) ?? [])];
      const index = entries.indexOf(document.activeElement as HTMLElement);
      entries[(index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length]?.focus();
      event.preventDefault();
    };
    const dismiss = () => setOpen(false);
    const scrolled = (event: Event) => { if (!(event.target instanceof Node && sheet.current?.contains(event.target))) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scrolled, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scrolled, true);
    };
  }, [open]);
  function toggle() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!open && rect) {
      const vertical = rect.bottom + 320 > window.innerHeight && rect.top > 320
        ? { "--row-menu-bottom": `${window.innerHeight - rect.top + 4}px` }
        : { "--row-menu-top": `${rect.bottom + 4}px` };
      const horizontal = rect.left + rect.width / 2 < window.innerWidth / 2
        ? { "--row-menu-left": `${rect.left}px` }
        : { "--row-menu-right": `${window.innerWidth - rect.right}px` };
      setPlace({ ...vertical, ...horizontal } as React.CSSProperties);
    }
    setOpen(value => !value);
  }
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return (
    <div className="row-menu" ref={root}>
      <button ref={trigger} type="button" className={triggerClassName ?? "row-menu-trigger"} aria-label={face ? undefined : label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>{face ?? "⋯"}</button>
      {open && createPortal(<div ref={sheet}>
        <div className="row-menu-backdrop" aria-hidden onClick={close} />
        <div className="row-menu-list" role="menu" id={id} aria-label={label} style={place}>
          {title && <p className="row-menu-title" aria-hidden>{title}</p>}
          {items.map((item, index) => {
            const heading = item.group && item.group !== items[index - 1]?.group
              ? <p className="row-menu-group" role="presentation">{item.group}</p> : null;
            const entry = item.href
              ? <Link role="menuitem" className="row-menu-item" href={item.href} onClick={() => setOpen(false)}>{item.label}</Link>
              : <button type="button" role={item.checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={item.checked} aria-disabled={item.disabled || undefined} className={`row-menu-item${item.danger ? " is-danger" : ""}`} onClick={() => { if (item.disabled) return; close(); item.onSelect?.(); }}>{item.label}</button>;
            return <Fragment key={`${item.group ?? ""}:${item.label}`}>{heading}{entry}</Fragment>;
          })}
        </div>
      </div>, document.body)}
    </div>
  );
}
