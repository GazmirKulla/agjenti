"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  isDashboardRoute,
  mobileBusinessNav,
  mobileAdminNav,
} from "./navigation";
import { BrandLogo } from "@/components/brand/logo";
import { Icon } from "./icon";
const businessNav = [
  ["", "Dashboard", "dashboard"],
  ["inbox", "Inbox", "inbox"],
  ["products", "Produkte", "products"],
  ["orders", "Porosi", "orders"],
  ["customers", "Klientë", "customers"],
  ["agents", "Agjenti AI", "agents"],
  ["knowledge", "Njohuria", "knowledge"],
  ["workflows", "Workflow", "workflows"],
  ["instagram", "Instagram", "instagram"],
  ["settings", "Cilësimet", "settings"],
];
const adminNav = [
  ["", "Dashboard", "dashboard"],
  ["businesses", "Bizneset", "businesses"],
  ["product-types", "Llojet", "products"],
  ["conversations", "Biseda & Integrime", "inbox"],
  ["app", "App", "settings"],
];
export function DashboardShell({
  children,
  name,
  slug,
  admin = false,
  email,
  userName,
  platformAdmin = false,
  businesses = [],
}: {
  children: React.ReactNode;
  name: string;
  slug?: string;
  admin?: boolean;
  email?: string;
  userName?: string;
  platformAdmin?: boolean;
  businesses?: { id: string; name: string; slug: string }[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const sync = () => {
      setMobile(media.matches);
      if (!media.matches) setOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    let restingHeight = viewport?.height ?? window.innerHeight;
    const sync = () => {
      const editing = document.activeElement?.matches(
        "input, textarea, select, [contenteditable='true']",
      );
      if (!editing) restingHeight = viewport?.height ?? window.innerHeight;
      setKeyboardOpen(
        Boolean(
          editing &&
          viewport &&
          Math.max(restingHeight, window.innerHeight) - viewport.height > 120,
        ),
      );
    };
    viewport?.addEventListener("resize", sync);
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
    };
  }, []);
  useEffect(() => {
    if (searchOpen && mobile) searchInput.current?.focus();
  }, [searchOpen, mobile]);
  useEffect(() => {
    if (!open || !mobile) return;
    const trigger = menuButton.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          "a[href],button,summary,input",
        ) ?? [],
      ).filter(
        (el) => el.getClientRects().length > 0 && !el.hasAttribute("disabled"),
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === "Tab") {
        const list = focusable();
        const first = list[0];
        const last = list.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open, mobile]);
  const base = admin ? "/admin" : `/b/${slug}`;
  const inboxDetailView = !admin && pathname.startsWith(`${base}/inbox/`);
  const items = admin ? adminNav : businessNav;
  const primaryItems = admin ? mobileAdminNav : mobileBusinessNav;
  return (
    <div
      className={`dashboard-shell ${open ? "drawer-open" : ""} ${keyboardOpen ? "keyboard-open" : ""} ${inboxDetailView ? "inbox-detail-view" : ""}`}
    >
      <aside
        ref={sidebar}
        id="dashboard-navigation"
        className={`dashboard-sidebar ${open ? "is-open" : ""}`}
        role={mobile && open ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-label={mobile && open ? "Menuja kryesore" : undefined}
      >
        <div className="mobile-drawer-header">
          <Link
            href={platformAdmin || admin ? "/admin" : base}
            className="dashboard-brand"
            onClick={() => setOpen(false)}
          >
            <BrandLogo size={36} priority />
          </Link>
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={() => setOpen(false)}
            aria-label="Mbyll menunë"
          >
            ×
          </button>
        </div>
        <details className="workspace-picker">
          <summary className="workspace-switch">
            <span className="workspace-avatar">
              {admin ? "A" : name.slice(0, 2).toUpperCase()}
            </span>
            <span>{name}</span>
            <span className="ml-auto">⌄</span>
          </summary>
          <div className="workspace-options">
            {(platformAdmin || admin) && (
              <Link href="/admin" onClick={() => setOpen(false)}>
                Platform Admin
              </Link>
            )}
            {businesses.map((b) => (
              <Link
                key={b.id}
                prefetch={false}
                href={`/b/${b.slug}`}
                aria-current={b.slug === slug ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {b.name}
              </Link>
            ))}
            {admin && (
              <Link href="/admin/businesses" onClick={() => setOpen(false)}>
                + Menaxho bizneset
              </Link>
            )}
          </div>
        </details>
        <nav
          aria-label={admin ? "Menuja e administratorit" : "Menuja e biznesit"}
        >
          {items.map(([path, label, icon]) => {
            const href = `${base}${path ? `/${path}` : ""}`;
            const active = isDashboardRoute(pathname, base, path);
            return (
              <Link
                key={path}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`dashboard-nav ${active ? "active" : ""} ${primaryItems.some(([p]) => p === path) ? "mobile-primary-item" : ""}`}
              >
                <Icon name={icon} />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
      {open && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Mbyll menunë"
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
      )}
      <div className="dashboard-main">
        <header
          className={`dashboard-topbar ${searchOpen ? "search-is-open" : ""}`}
        >
          <button
            type="button"
            ref={menuButton}
            aria-controls="dashboard-navigation"
            className="mobile-menu btn btn-ghost"
            aria-label="Hap ose mbyll menunë"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name="dashboard" />
          </button>
          <Link className="mobile-workspace-title" href={base}>
            <strong>{name}</strong>
            <small>{admin ? "Administrimi" : "Agjenti.app"}</small>
          </Link>
          <button
            className="mobile-search-toggle btn btn-ghost"
            type="button"
            aria-label={searchOpen ? "Mbyll kërkimin" : "Hap kërkimin"}
            aria-expanded={searchOpen}
            aria-controls="dashboard-page-search"
            onClick={() => {
              setSearchOpen(!searchOpen);
              setSearch("");
            }}
          >
            <Icon name="search" />
          </button>
          <div className="dashboard-search" id="dashboard-page-search">
            <Icon name="search" size={18} />
            <input
              ref={searchInput}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  setSearch("");
                }
              }}
              aria-label="Kërko faqe"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kërko në panel…"
            />
            {search && (
              <div className="search-results">
                {items
                  .filter(([, label]) =>
                    label
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                  )
                  .map(([path, label]) => (
                    <Link
                      key={path}
                      onClick={() => {
                        setSearch("");
                        setSearchOpen(false);
                        setOpen(false);
                      }}
                      href={`${base}/${path}`}
                    >
                      {label}
                      <Icon name="arrow" size={15} />
                    </Link>
                  ))}
                {!items.some(([, label]) =>
                  label
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                ) && <p>Nuk u gjet asnjë faqe.</p>}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <Link
              href="/account"
              className="topbar-profile account-profile-link"
              aria-label="Hap profilin dhe cilësimet e llogarisë"
              title="Profili dhe cilësimet"
            >
              <span className="profile-avatar">
                {(userName || email || name).slice(0, 2).toUpperCase()}
              </span>
              <span>
                <strong>{userName || email || name}</strong>
                <small>Profili dhe cilësimet</small>
              </span>
            </Link>
          </div>
        </header>
        <main className="dashboard-content">{children}</main>
      </div>
      <nav
        className="mobile-bottom-nav"
        aria-label={admin ? "Navigimi kryesor i adminit" : "Navigimi kryesor"}
      >
        {primaryItems.map(([path, label, icon]) => (
          <Link
            key={path}
            href={`${base}${path ? `/${path}` : ""}`}
            prefetch={false}
            aria-current={
              isDashboardRoute(pathname, base, path) ? "page" : undefined
            }
            onClick={() => {
              setOpen(false);
              setSearchOpen(false);
              setSearch("");
            }}
          >
            <Icon name={icon} size={22} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
