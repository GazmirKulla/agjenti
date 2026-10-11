"use client";

import Link from "next/link";
import { Icon } from "./icon";
import { activeWorkspaceLink, type organizeWorkspace, type WorkspaceSection } from "@/lib/dashboard/navigation/workspace";
import s from "./workspace-navigation.module.css";

type Props = { navigation: ReturnType<typeof organizeWorkspace>; section?: WorkspaceSection; base: string; pathname: string; onNavigate: () => void };

export function WorkspaceNavigation({ navigation, section, base, pathname, onNavigate }: Props) {
  const activeBusiness = activeWorkspaceLink(pathname, base, navigation.business);
  const first = new Set(["home", "conversations", "integrations"]);
  const business = new Set(["products", "orders", "customers"]);
  const renderLink = (item: typeof navigation.primary[number]) => <Link key={item.id} href={`${base}${item.path ? `/${item.path}` : ""}`} className={`dashboard-nav ${section === item.section ? "active" : ""}`} aria-current={section === item.section ? "page" : undefined} onClick={onNavigate}><Icon name={item.icon} />{item.label}</Link>;
  const hasBusiness = navigation.primary.some(item => business.has(item.id)) || navigation.groups.length > 0;
  return <>
    {navigation.primary.filter(item => first.has(item.id)).map(renderLink)}
    {hasBusiness && <hr className={s.divider} />}
    {navigation.primary.filter(item => business.has(item.id)).map(renderLink)}
    {navigation.groups.length > 0 && (
    <details key={pathname} className={s.business} open={section === "business"}>
      <summary className={`dashboard-nav ${section === "business" ? "active" : ""}`}><Icon name="briefcase" />Biznesi<span className={s.chevron} aria-hidden>⌄</span></summary>
      <div className={s.businessLinks}>{navigation.groups.length ? navigation.groups.map(group => <div key={group.label}><p className={s.groupLabel}>{group.label}</p>{group.items.map(item => <Link key={item.id} href={`${base}/${item.path}`} aria-current={activeBusiness === item.path ? "page" : undefined} onClick={onNavigate}><Icon name={item.icon} size={17} />{item.label}</Link>)}</div>) : <Link href={`${base}/settings`} onClick={onNavigate}>Menaxho modulet →</Link>}</div>
    </details>
    )}
    <hr className={s.divider} />
    {navigation.primary.filter(item => !first.has(item.id) && !business.has(item.id)).map(renderLink)}
  </>;
}

export function WorkspaceSectionNavigation({ navigation, section, base, pathname }: Omit<Props, "onNavigate">) {
  if (section === "integrations") return pathname === `${base}/integrations` ? null : <div className={s.context}><Link className="soft-link" href={`${base}/integrations`}>← Integrimet</Link></div>;
  const links = section === "agent" ? navigation.agent : section === "settings" ? navigation.settings : section === "business" ? navigation.business : [];
  if (!links.length) return null;
  const title = section === "agent" ? "Agjenti im" : section === "settings" ? "Cilësimet" : "Biznesi";
  const active = activeWorkspaceLink(pathname, base, links);
  return <section className={s.context}><p>{title}</p><nav aria-label={`Seksionet — ${title}`} className={s.sections}>{links.map(item => <Link key={item.id} href={`${base}/${item.path}`} aria-current={active === item.path ? "page" : undefined}><Icon name={item.icon} size={16} />{item.label}</Link>)}</nav></section>;
}
