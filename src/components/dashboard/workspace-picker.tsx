"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/modal/modal";
import { useDashboardTranslator } from "./language";

type Business = { id: string; name: string; slug: string };

/**
 * The workspace switch at the top of the sidebar: shows the current workspace and opens the list of
 * businesses (and Platform Admin) in the app's modal, with a search once the list grows.
 */
export function WorkspacePicker({ name, slug, admin, platformAdmin, businesses, compact, onNavigate }: {
  name: string;
  slug?: string;
  admin: boolean;
  platformAdmin: boolean;
  businesses: Business[];
  /** The icon-only sidebar: the name shows as a tooltip. */
  compact?: boolean;
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

  return <div className="workspace-picker">
    <button type="button" className="workspace-switch" data-tip={compact ? name : undefined} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <span className="workspace-avatar">{admin ? "A" : name.slice(0, 2).toUpperCase()}</span>
      <span className="nav-label">{name}</span>
      <span className="ml-auto" aria-hidden="true">⌄</span>
    </button>
    <Modal open={open} onClose={close} title={t("Zgjidh biznesin")} subtitle={`${businesses.length} ${t("biznese")}`}
      footer={admin
        ? <Link className="btn btn-ghost" href="/admin/businesses" onClick={choose}>{t("Menaxho bizneset")}</Link>
        : !platformAdmin && <Link className="btn btn-ghost" href="/onboarding?new=1" prefetch={false} onClick={choose}>+ {t("Krijo biznes të ri")}</Link>}>
      {businesses.length > 6 && <input className="field workspace-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={t("Kërko biznesin")} aria-label={t("Kërko biznesin")} autoFocus />}
      <nav className="workspace-list" aria-label={t("Bizneset")}>
        {showAdmin && <Link href="/admin" aria-current={admin ? "page" : undefined} onClick={choose}>
          <span className="workspace-avatar">A</span><span>Platform Admin</span>
        </Link>}
        {shown.map(b => <Link key={b.id} prefetch={false} href={`/b/${b.slug}`} aria-current={b.slug === slug ? "page" : undefined} onClick={choose}>
          <span className="workspace-avatar">{b.name.slice(0, 2).toUpperCase()}</span><span>{b.name}</span>
        </Link>)}
        {!shown.length && !showAdmin && <p className="muted-copy">{t("Asnjë biznes me këtë emër.")}</p>}
      </nav>
    </Modal>
  </div>;
}
