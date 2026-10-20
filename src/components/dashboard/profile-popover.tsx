"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/lib/auth/actions";
import { Icon } from "./icon";
import { useDashboardTranslator } from "./language";
import s from "./app-shell.module.css";

export function ProfilePopover({ base, name, email, compact, onNavigate }: {
  base: string; name: string; email?: string; compact: boolean; onNavigate: () => void;
}) {
  const t = useDashboardTranslator();
  const pathname = usePathname();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const links = [
    { path: "profile", label: "Profili", icon: "customers" },
    { path: "profile", label: "Cilësimet", icon: "settings" },
    { path: "billing", label: "Paketa dhe përdorimi", icon: "billing" },
    { path: "preferences#language", label: "Gjuha / Language", icon: "display" },
  ];
  return <div ref={root} className={s.profile} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) close();
  }}>
    <button ref={trigger} type="button" className={s.profileTrigger}
      aria-label={`${t("Menuja e profilit")}: ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(!open)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}>
      <span className="profile-avatar" aria-hidden>{name.slice(0, 2).toUpperCase()}</span>
      {!compact && <span className={s.profileCopy}><strong>{name}</strong><small>{t("Llogaria jote")}</small></span>}
      {!compact && <span aria-hidden>⌃</span>}
    </button>
    {open && <div ref={menu} id={id} role="menu" aria-label={t("Menuja e profilit")} className={s.popover}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const list = items();
          const current = list.indexOf(document.activeElement as HTMLElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + list.length) % list.length;
          list[next]?.focus();
        }
      }}>
      <div className={s.profileHeading} role="presentation"><strong>{name}</strong><span>{email}</span></div>
      {links.map(item => {
        const href = `${base}/settings${item.path ? `/${item.path}` : ""}`;
        return <Link role="menuitem" key={item.label} href={href}
          aria-current={item.label !== "Cilësimet" && pathname === href.split("#")[0] ? "page" : undefined}
          onClick={() => { close(); onNavigate(); }}><Icon name={item.icon} size={17}/>{t(item.label)}</Link>;
      })}
      <form action={async () => {
        setPending(true); setError("");
        try { await signOut(); }
        catch (failure) {
          // Next's successful redirect is control flow, not a sign-out failure.
          if (failure && typeof failure === "object" && "digest" in failure && String(failure.digest).startsWith("NEXT_REDIRECT")) throw failure;
          setError(t("Dalja dështoi. Provo përsëri.")); setPending(false);
        }
      }}>
        <button role="menuitem" type="submit" disabled={pending}><Icon name="arrow" size={17}/>{t(pending ? "Duke dalë…" : "Dil nga llogaria")}</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>}
  </div>;
}
