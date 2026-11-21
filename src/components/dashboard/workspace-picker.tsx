"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/modal/modal";
import { useDashboardTranslator } from "./language";
import { BusinessAvatar } from "./business-avatar";

type Business = { id: string; name: string; slug: string; logo_url?: string | null };

/**
 * The workspace switch at the top of the sidebar: shows the current workspace and opens the list of
 * businesses (and Platform Admin) in the app's modal, with a search once the list grows.
 */
export function WorkspacePicker({ name, slug, admin, platformAdmin, businesses, compact, topbar, onNavigate }: {
  name: string;
  slug?: string;
  admin: boolean;
  platformAdmin: boolean;
  businesses: Business[];
  /** The icon-only sidebar: the name shows as a tooltip. */
  compact?: boolean;
  /** The phone header: only the logo (or initials) and ⌄; the name is the button's label. */
  topbar?: boolean;
  /** Runs after a choice, e.g. to close the mobile drawer. */
  onNavigate: () => void;
}) {
  const t = useDashboardTranslator();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const close = () => { setOpen(false); setQuery(""); };
  const choose = () => { close(); onNavigate(); };
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? businesses.filter(b => b.name.toLocaleLowerCase().includes(needle)) : businesses;
  const showAdmin = (platformAdmin || admin) && (!needle || "platform admin".includes(needle));

  const avatar = admin ? <BusinessAvatar name={name} initials="A" size={topbar ? 32 : undefined} />
    : <BusinessAvatar name={name} logoUrl={businesses.find(b => b.slug === slug)?.logo_url} size={topbar ? 32 : undefined} />;
  return <div className={`workspace-picker${topbar ? " is-topbar" : ""}`}>
    {topbar
      ? <button type="button" className="topbar-workspace-switch" title={name} aria-label={`${t("Zgjidh biznesin")}: ${name}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {avatar}<svg className="topbar-workspace-chevron" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      : <button type="button" className="workspace-switch" data-tip={compact ? name : undefined} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {avatar}
          <span className="nav-label">{name}</span>
          <span className="ml-auto" aria-hidden="true">⌄</span>
        </button>}
    <Modal open={open} onClose={close} title={t("Zgjidh biznesin")} subtitle={`${businesses.length} ${t("biznese")}`}
      footer={admin
        ? <Link className="btn btn-ghost" href="/admin/businesses" onClick={choose}>{t("Menaxho bizneset")}</Link>
        : !platformAdmin && <Link className="btn btn-ghost" href="/onboarding?new=1" prefetch={false} onClick={choose}>+ {t("Krijo biznes të ri")}</Link>}>
      {businesses.length > 6 && <input className="field workspace-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={t("Kërko biznesin")} aria-label={t("Kërko biznesin")} autoFocus />}
      <nav className="workspace-list" aria-label={t("Bizneset")}>
        {showAdmin && <Link href="/admin" aria-current={admin ? "page" : undefined} onClick={choose}>
          <BusinessAvatar name="Platform Admin" initials="A" /><span>Platform Admin</span>
        </Link>}
        {shown.map(b => <Link key={b.id} prefetch={false} href={`/b/${b.slug}`} aria-current={b.slug === slug ? "page" : undefined} onClick={choose}>
          <BusinessAvatar name={b.name} logoUrl={b.logo_url} /><span>{b.name}</span>
        </Link>)}
        {!shown.length && !showAdmin && <p className="muted-copy">{t("Asnjë biznes me këtë emër.")}</p>}
      </nav>
    </Modal>
  </div>;
}
