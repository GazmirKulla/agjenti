"use client";
import { useEffect, useState } from "react";
import { useDashboardTranslator } from "./language";

import Link from "next/link";
import { Icon } from "./icon";
import { activeWorkspaceLink, workspaceLabel, type WorkspaceLink, type organizeWorkspace, type WorkspaceSection } from "@/lib/dashboard/navigation/workspace";
import s from "./workspace-navigation.module.css";

type Props = { navigation: ReturnType<typeof organizeWorkspace>; section?: WorkspaceSection; base: string; pathname: string; onNavigate: () => void; iconsOnly?: boolean; assistantName?: string };

function NavigationGroup({ id, label, icon, href, links, base, pathname, iconsOnly, onNavigate }: {
  id: string; label: string; icon: string; href: string; links: WorkspaceLink[];
  base: string; pathname: string; iconsOnly: boolean; onNavigate: () => void;
}) {
  const t = useDashboardTranslator();
  const active = activeWorkspaceLink(pathname, base, links);
  const [collapsedAt, setCollapsedAt] = useState<string | null>(null);
  useEffect(() => {
    if ((active !== undefined || pathname === href) && collapsedAt !== pathname) setCollapsedAt(null);
  }, [active, pathname, href, collapsedAt]);
  // A new destination reopens its group; a user can still collapse it explicitly.
  const expanded = iconsOnly || collapsedAt === null || (active !== undefined && collapsedAt !== pathname);
  return <section className={s.group} aria-label={t(label)}>
    <div className={s.groupHeading}>
      <Link href={href} className={`dashboard-nav ${pathname === href && active === undefined ? "active" : ""}`}
        aria-current={pathname === href && active === undefined ? "page" : undefined} data-tip={iconsOnly ? t(label) : undefined} onClick={onNavigate}>
        <Icon name={icon}/><span className="nav-label">{t(label)}</span>
      </Link>
      {!iconsOnly && <button type="button" className={s.groupToggle} aria-label={`${t(expanded ? "Mbyll grupin" : "Hap grupin")} ${t(label)}`}
        aria-expanded={expanded} aria-controls={`workspace-${id}`} onClick={() => setCollapsedAt(expanded ? pathname : null)}>
        <span className={expanded ? s.expanded : undefined} aria-hidden="true">⌄</span>
      </button>}
    </div>
    <div id={`workspace-${id}`} className={s.businessLinks} hidden={!expanded}>
      {links.map(item => <Link key={item.path} href={`${base}/${item.path}`} aria-current={active === item.path ? "page" : undefined}
        data-tip={iconsOnly ? t(workspaceLabel(item)) : undefined} onClick={onNavigate}>
        <Icon name={item.icon} size={17}/><span className="nav-label">{t(workspaceLabel(item))}</span>
      </Link>)}
    </div>
  </section>;
}

export function WorkspaceNavigation({ navigation, section, base, pathname, onNavigate, iconsOnly = false, assistantName }: Props) {
  const t = useDashboardTranslator();
  return <>
    {navigation.main.map(item => {
      const label = item.id === "home" && assistantName ? assistantName : t(item.label);
      return <Link key={item.id} href={`${base}${item.path ? `/${item.path}` : ""}`} className={`dashboard-nav ${section === item.section ? "active" : ""}`}
        aria-current={section === item.section ? "page" : undefined} data-tip={iconsOnly ? label : undefined} onClick={onNavigate}>
        <Icon name={item.icon}/><span className="nav-label">{label}</span>
      </Link>;
    })}
    <hr className={s.divider}/>
    <NavigationGroup id="management" label="Menaxhimi" icon="briefcase" href={`${base}/business`} links={navigation.management}
      base={base} pathname={pathname} iconsOnly={iconsOnly} onNavigate={onNavigate}/>
    {navigation.agent.length > 0 && <NavigationGroup id="agent" label="Agjenti" icon="agents" href={`${base}/${navigation.agent[0].path}`}
      links={navigation.agent} base={base} pathname={pathname} iconsOnly={iconsOnly} onNavigate={onNavigate}/>}
    {navigation.integrations.length > 0 && <NavigationGroup id="channels" label="Kanalet" icon="integrations" href={`${base}/integrations`}
      links={navigation.integrations} base={base} pathname={pathname} iconsOnly={iconsOnly} onNavigate={onNavigate}/>}
    <Link href={`${base}/settings`} className={`dashboard-nav ${section === "settings" ? "active" : ""}`}
      aria-current={pathname === `${base}/settings` ? "page" : undefined} data-tip={iconsOnly ? t("Cilësimet") : undefined} onClick={onNavigate}>
      <Icon name="settings"/><span className="nav-label">{t("Cilësimet")}</span>
    </Link>
  </>;
}

export function WorkspaceSectionNavigation({ navigation, section, base, pathname }: Omit<Props, "onNavigate">) {
  const t = useDashboardTranslator();
  if (section === "integrations") return pathname === `${base}/integrations` ? null : <div className={s.context}><Link className="soft-link" href={`${base}/integrations`}>{t("← Integrimet")}</Link></div>;
  const links = section === "agent" ? navigation.agent : section === "settings" ? navigation.settings : section === "business" ? navigation.business : [];
  if (!links.length) return null;
  const title = section === "agent" ? "Agjenti i klientëve" : section === "settings" ? "Cilësimet" : "Biznesi";
  const active = activeWorkspaceLink(pathname, base, links);
  const advanced = links.filter(item => item.id === "workflows");
  return <section className={s.context}>
    <p>{t(title)}{section === "agent" ? " — Instagram / WhatsApp" : ""}</p>
    <nav aria-label={`Seksionet — ${t(title)}`} className={s.sections}>
      {links.filter(item => item.id !== "workflows").map(item => <Link key={item.id} href={`${base}/${item.path}`} aria-current={active === item.path ? "page" : undefined}><Icon name={item.icon} size={16} />{t(item.label)}</Link>)}
      {!!advanced.length && <details key={pathname} className={s.advanced} open={active === "workflows"}>
        <summary>{t("Avancuar")}</summary>
        {advanced.map(item => <Link key={item.id} href={`${base}/${item.path}`} aria-current={active === item.path ? "page" : undefined}><Icon name={item.icon} size={16} />Workflow Designer</Link>)}
      </details>}
    </nav>
  </section>;
}
