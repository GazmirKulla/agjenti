"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
  ["conversations", "Biseda & Integrime", "inbox"],
];
export function DashboardShell({
  children,
  name,
  slug,
  admin = false,
  email,
}: {
  children: React.ReactNode;
  name: string;
  slug?: string;
  admin?: boolean;
  email?: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const base = admin ? "/admin" : `/b/${slug}`;
  const items = admin ? adminNav : businessNav;
  return (
    <div className="dashboard-shell">
      <aside className={`dashboard-sidebar ${open ? "is-open" : ""}`}>
        <Link href="/app" className="dashboard-brand">
          <span className="brand-symbol">A</span> Agjenti.app
        </Link>
        <Link href="/app" className="workspace-switch">
          <span className="workspace-avatar">
            {admin ? <Icon name="spark" /> : name.slice(0, 2).toUpperCase()}
          </span>
          <span>{name}</span>
          <span className="ml-auto">⌄</span>
        </Link>
        <nav
          aria-label={admin ? "Menuja e administratorit" : "Menuja e biznesit"}
        >
          {items.map(([path, label, icon]) => {
            const href = `${base}${path ? `/${path}` : ""}`;
            const active = path ? pathname.startsWith(href) : pathname === base;
            return (
              <Link
                key={path}
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`dashboard-nav ${active ? "active" : ""}`}
              >
                <Icon name={icon} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-promo">
          <span className="icon-tile">
            <Icon name="spark" size={25} />
          </span>
          <h3>{admin ? "Platform Admin" : "Rrit shitjet me Agjentin AI"}</h3>
          <p>
            {admin
              ? "Menaxho bizneset dhe ndiq aktivitetin e platformës."
              : "Njohuritë e biznesit tënd, në çdo bisedë me klientët."}
          </p>
          <Link
            href={admin ? "/admin/businesses" : `${base}/agents`}
            className="btn btn-primary"
          >
            {admin ? "Menaxho bizneset" : "Konfiguro agjentin"}
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </aside>
      {open && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Mbyll menunë"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <button
            type="button"
            className="mobile-menu btn btn-ghost"
            aria-label="Hap ose mbyll menunë"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            ☰
          </button>
          <div className="dashboard-search">
            <Icon name="search" size={18} />
            <input
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
                      onClick={() => setSearch("")}
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
          <Link href="/app" className="topbar-profile">
            <span className="profile-avatar">
              {name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{name}</strong>
              <small>
                {admin ? "Platform Admin" : email || "Hapësira e biznesit"}
              </small>
            </span>
            <span>⌄</span>
          </Link>
        </header>
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
