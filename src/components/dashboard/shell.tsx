"use client";
import { useDashboardTranslator } from "./language";
import { ProfilePopover } from "./profile-popover";
import s from "./app-shell.module.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { isDashboardRoute } from "./navigation";
import { organizeWorkspace, workspaceSection } from "@/lib/dashboard/navigation/workspace";
import { WorkspaceNavigation, WorkspaceSectionNavigation } from "./workspace-navigation";
import type { NavItem } from "@/lib/dashboard/navigation/builder";
import { BrandLogo } from "@/components/brand/logo";
import { Icon } from "./icon";
import { AssistantWorkspaceSurface, AssistantEntry, useAssistantWorkspace } from "@/components/business-assistant/workspace";

export function AppShell({
  children,
  name,
  slug,
  admin = false,
  email,
  userName,
  platformAdmin = false,
  businesses = [],
  navigationItems,
  mobileNavigationItems,
}: {
  children: React.ReactNode;
  name: string;
  slug?: string;
  admin?: boolean;
  email?: string;
  userName?: string;
  platformAdmin?: boolean;
  businesses?: { id: string; name: string; slug: string }[];
  navigationItems: NavItem[];
  mobileNavigationItems: NavItem[];
}) {
  const [nativeHost, setNativeHost] = useState(false);
  useEffect(() => { setNativeHost(/AgjentiNative\/2\.0/.test(navigator.userAgent)); }, []);
  const t = useDashboardTranslator();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [backdrop, setBackdrop] = useState(false);
  const assistant = useAssistantWorkspace();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [iconsOnly, setIconsOnly] = useState(false);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
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
    try {
      setIconsOnly(localStorage.getItem("agjenti.sidebar.icons") === "1");
    } catch {
      /* Preference stays expanded when storage is unavailable. */
    }
  }, []);
  const iconRail = iconsOnly && !mobile;
  useEffect(() => {
    const nav = sidebar.current?.querySelector("nav");
    if (!nav) return;
    const hide = () => setTip(null);
    nav.addEventListener("scroll", hide, { passive: true });
    return () => nav.removeEventListener("scroll", hide);
  }, [iconRail]);
  function toggleIcons() {
    setTip(null);
    setIconsOnly((current) => {
      const next = !current;
      try {
        localStorage.setItem("agjenti.sidebar.icons", next ? "1" : "0");
      } catch {
        /* The choice still applies for this visit. */
      }
      return next;
    });
  }
  function showTip(event: React.SyntheticEvent) {
    const el = (event.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]");
    const text = el?.dataset.tip;
    if (!el || !text || (!iconRail && !el.classList.contains("sidebar-icon-toggle"))) return;
    const rect = el.getBoundingClientRect();
    const top = rect.top + rect.height / 2;
    const left = rect.right + 8;
    setTip((current) => current?.text === text && Math.abs(current.top - top) < 1 && Math.abs(current.left - left) < 1 ? current : { text, top, left });
  }
  function hideTip(event: React.MouseEvent | React.FocusEvent) {
    const next = (event.relatedTarget as HTMLElement | null)?.closest?.("[data-tip]");
    if (next && event.currentTarget.contains(next)) return;
    setTip(null);
  }
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
    if (!open || !mobile) {
      setBackdrop(false);
      return;
    }
    const frame = requestAnimationFrame(() => setBackdrop(true));
    return () => cancelAnimationFrame(frame);
  }, [open, mobile]);
  useEffect(() => {
    if (!open || !mobile) return;
    const trigger = menuButton.current;
    const root = document.documentElement;
    const scrollY = window.scrollY;
    root.classList.add("drawer-scroll-lock");
    root.style.setProperty("--drawer-scroll-y", `-${scrollY}px`);
    const focusable = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          "a[href],button,summary,input",
        ) ?? [],
      ).filter(
        (el) =>
          !el.classList.contains("mobile-drawer-close") &&
          el.getClientRects().length > 0 &&
          !el.hasAttribute("disabled"),
      );
    const closeButton = sidebar.current?.querySelector<HTMLElement>(
      ".mobile-drawer-close",
    );
    (closeButton ?? focusable()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === "Tab") {
        const list = [
          ...(closeButton ? [closeButton] : []),
          ...focusable(),
        ];
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
      root.classList.remove("drawer-scroll-lock");
      root.style.removeProperty("--drawer-scroll-y");
      window.scrollTo(0, scrollY);
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open, mobile]);
  const base = admin ? "/admin" : `/b/${slug}`;
  const inboxDetailView = !admin && pathname.startsWith(`${base}/inbox/`);
  const items = navigationItems;
  const workspace = organizeWorkspace(items);
  const section = workspaceSection(pathname, base, workspace);
  const searchItems = admin ? items : workspace.search;
  const primaryItems = mobileNavigationItems;
  const mobilePaths = new Set(primaryItems.map((item) => item.path));
  if (nativeHost && !admin) return <main className="native-business-content">{children}</main>;
  return (
    <div
      style={{"--assistant-panel-width": `${assistant?.panelWidth ?? 440}px`} as React.CSSProperties}
      className={`dashboard-shell ${!admin ? s.shell : ""} ${iconRail ? "is-icons" : ""} ${!admin && slug ? "has-assistant-dock assistant-first-mobile assistant-workspace" : ""} ${!admin && pathname === base ? "mobile-assistant-home" : ""} ${assistant?.open && pathname !== base ? "assistant-panel-open" : ""} ${open ? "drawer-open" : ""} ${keyboardOpen ? "keyboard-open" : ""} ${inboxDetailView ? "inbox-detail-view" : ""}`}
    >
      <aside
        ref={sidebar}
        id="dashboard-navigation"
        className={`dashboard-sidebar ${open ? "is-open" : ""}`}
        onMouseOver={showTip}
        onMouseOut={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        role={mobile && open ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-label={mobile && open ? t("Menuja kryesore") : undefined}
        aria-hidden={mobile && !open ? true : undefined}
        inert={mobile && !open ? true : undefined}
      >
        <div className="mobile-drawer-header">
          <Link
            href={platformAdmin || admin ? "/admin" : base}
            className="dashboard-brand"
            data-tip={iconRail ? "agjenti.app" : undefined}
            onClick={() => setOpen(false)}
          >
            <BrandLogo size={36} priority />
          </Link>
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={() => setOpen(false)}
            aria-label={t("Mbyll menunë")}
          >
            ×
          </button>
        </div>
        <details className="workspace-picker">
          <summary className="workspace-switch" data-tip={iconRail ? name : undefined}>
            <span className="workspace-avatar">
              {admin ? "A" : name.slice(0, 2).toUpperCase()}
            </span>
            <span className="nav-label">{name}</span>
            <span className="ml-auto" aria-hidden="true">⌄</span>
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
          aria-label={admin ? "Menuja e administratorit" : t("Menuja e biznesit")}
        >
          {admin ? items.map((item) => {
            const href = `${base}${item.path ? `/${item.path}` : ""}`;
            const active = isDashboardRoute(pathname, base, item.path);
            return (
              <Link
                key={item.id}
                href={href}
                aria-current={active ? "page" : undefined}
                data-tip={iconRail ? item.label : undefined}
                onClick={() => setOpen(false)}
                className={`dashboard-nav ${active ? "active" : ""} ${admin && mobilePaths.has(item.path) ? "mobile-primary-item" : ""}`}
              >
                <Icon name={item.icon} />
                <span className="nav-label">{admin ? item.label : t(item.label)}</span>
              </Link>
            );
          }) : <WorkspaceNavigation navigation={workspace} section={section} base={base} pathname={pathname} assistantName={assistant?.appearance.name} iconsOnly={iconRail} onNavigate={() => { setOpen(false); if (mobile) assistant?.setOpen(false); }} />}
        </nav>
        <footer className="dashboard-sidebar-footer">
          {!admin ? <ProfilePopover key={pathname} base={base} name={userName || email || name} email={email} compact={iconRail} onNavigate={() => { setOpen(false); assistant?.setOpen(false); }} /> : <Link
            href={`${base}/account`}
            className={`dashboard-nav sidebar-account-link ${isDashboardRoute(pathname, base, "account") ? "active" : ""}`}
            aria-current={isDashboardRoute(pathname, base, "account") ? "page" : undefined}
            data-tip={iconRail ? t("Llogaria") : undefined}
            onClick={() => setOpen(false)}
          >
            <span className="profile-avatar" aria-hidden="true">
              {(userName || email || name).slice(0, 2).toUpperCase()}
            </span>
            <span className="nav-label">{t("Llogaria")}</span>
          </Link>}
        </footer>
      </aside>
      {tip && (
        <div className="sidebar-tip" style={{ top: tip.top, left: tip.left }} aria-hidden="true">
          {tip.text}
        </div>
      )}
      {backdrop && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t("Mbyll menunë")}
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
            aria-label={t("Hap ose mbyll menunë")}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon name="menu" size={28} />
          </button>
          {!admin && mobile ? <label className="mobile-business-selector"><span className="sr-only">Biznesi aktiv</span><select value={slug} onChange={event => { window.location.assign(`/b/${encodeURIComponent(event.target.value)}`); }} aria-label="Biznesi aktiv">{businesses.map(b => <option key={b.id} value={b.slug}>{b.name}</option>)}</select><small>Agjenti.app</small></label> : <Link className="mobile-workspace-title" href={base}>
            <strong>{name}</strong>
            <small>{admin ? "Administrimi" : "Agjenti.app"}</small>
          </Link>}
          {!admin && <div className="mobile-assistant-tools">
            <button type="button" aria-label="Historiku i asistentit" aria-expanded={assistant?.historyOpen} aria-controls="assistant-history" onClick={() => assistant?.setHistoryOpen(true)}><Icon name="history" size={21}/></button>
            <button type="button" aria-label="Bisedë e re me asistentin" disabled={assistant?.sending} onClick={() => { assistant?.resetRef.current?.(); assistant?.setOpen(true); }}><Icon name="edit" size={21}/></button>
          </div>}
          <button
            className="mobile-search-toggle btn btn-ghost"
            type="button"
            aria-label={searchOpen ? t("Mbyll kërkimin") : t("Hap kërkimin")}
            aria-expanded={searchOpen}
            aria-controls="dashboard-page-search"
            onClick={() => {
              setSearchOpen(!searchOpen);
              setSearch("");
            }}
          >
            <Icon name="search" />
          </button>
          <div className="topbar-search-row">
          <button
            type="button"
            className="sidebar-icon-toggle"
            aria-pressed={iconsOnly}
            aria-label={t(iconsOnly ? "Shfaq menunë me tekst" : "Shfaq vetëm ikonat")}
            data-tip={t(iconsOnly ? "Shfaq menunë me tekst" : "Shfaq vetëm ikonat")}
            onClick={toggleIcons}
            onMouseOver={showTip}
            onMouseOut={hideTip}
            onFocus={showTip}
            onBlur={hideTip}
          >
            <Icon name="sidebar" size={18} />
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
              aria-label={t("Kërko faqe")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Kërko në panel…")}
            />
            {search && (
              <div className="search-results">
                {searchItems
                  .filter((item) =>
                    t(item.label)
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                  )
                  .map((item) => (
                    <Link
                      key={`${item.id}-${admin ? item.label : t(item.label)}`}
                      onClick={() => {
                        setSearch("");
                        setSearchOpen(false);
                        setOpen(false);
                      }}
                      href={`${base}${item.path ? `/${item.path}` : ""}`}
                    >
                      {admin ? item.label : t(item.label)}
                      <Icon name="arrow" size={15} />
                    </Link>
                  ))}
                {!searchItems.some((item) =>
                  t(item.label)
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                ) && <p>{t("Nuk u gjet asnjë faqe.")}</p>}
              </div>
            )}
          </div>
          </div>
          {!admin && slug && <div id="personal-assistant-slot" className="personal-assistant-slot" />}
        </header>
        <main className="dashboard-content">
          {/* Stable placement retains pending cards and the composer across navigation. */}
          {!admin && <AssistantWorkspaceSurface/>}
          {!admin && !isDashboardRoute(pathname, base, "settings") && <WorkspaceSectionNavigation navigation={workspace} section={section} base={base} pathname={pathname} />}
          {!admin && pathname !== base && !isDashboardRoute(pathname, base, "settings") && <AssistantEntry/>}
          {children}
        </main>
      </div>
      {admin && <nav
        className="mobile-bottom-nav"
        aria-label={admin ? "Navigimi kryesor i adminit" : "Navigimi kryesor"}
      >
        {primaryItems.map((item) => (
          <Link
            key={item.id}
            href={`${base}${item.path ? `/${item.path}` : ""}`}
            prefetch={false}
            aria-current={
              isDashboardRoute(pathname, base, item.path) ? "page" : undefined
            }
            onClick={() => {
              setOpen(false);
              setSearchOpen(false);
              setSearch("");
            }}
          >
            <Icon name={item.icon} size={22} />
            <span>{admin ? item.label : t(item.label)}</span>
          </Link>
        ))}
      </nav>}

    </div>
  );
}

// Compatibility for the independent administrator layout.
export { AppShell as DashboardShell };
