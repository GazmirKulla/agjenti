"use client";
import { useDashboardTranslator } from "./language";

import Link from "next/link";
import { Icon } from "./icon";
import { activeWorkspaceLink, type organizeWorkspace, type WorkspaceSection } from "@/lib/dashboard/navigation/workspace";
import s from "./workspace-navigation.module.css";

type Props = { navigation: ReturnType<typeof organizeWorkspace>; section?: WorkspaceSection; base: string; pathname: string; onNavigate: () => void; iconsOnly?: boolean };

export function WorkspaceNavigation({ navigation, section, base, pathname, onNavigate, iconsOnly = false }: Props) {
  const t = useDashboardTranslator();
  const activeBusiness = activeWorkspaceLink(pathname, base, navigation.business);
  const first = new Set(["home", "conversations", "integrations"]);
  const business = new Set(["products", "services", "orders", "leads", "customers"]);
  const renderLink = (item: typeof navigation.primary[number]) => {
    const label = t(item.label);
    return <Link key={item.id} href={`${base}${item.path ? `/${item.path}` : ""}`} className={`dashboard-nav ${section === item.section ? "active" : ""}`} aria-current={section === item.section ? "page" : undefined} data-tip={iconsOnly ? label : undefined} onClick={onNavigate}><Icon name={item.icon} /><span className="nav-label">{label}</span></Link>;
  };
  const hasBusiness = navigation.primary.some(item => business.has(item.id)) || navigation.groups.length > 0;
  return <>
    {navigation.primary.filter(item => first.has(item.id)).map(renderLink)}
    {hasBusiness && <hr className={s.divider} />}
    {navigation.primary.filter(item => business.has(item.id)).map(renderLink)}
    {navigation.groups.length > 0 && (
    <details key={pathname} className={s.business} open={section === "business"}>
      <summary className={`dashboard-nav ${section === "business" ? "active" : ""}`} data-tip={iconsOnly ? t("Biznesi") : undefined}><Icon name="briefcase" /><span className="nav-label">{t("Biznesi")}</span><span className={s.chevron} aria-hidden>⌄</span></summary>
      <div className={s.businessLinks}>{navigation.groups.length ? navigation.groups.map(group => <div key={group.label}><p className={s.groupLabel}>{group.label}</p>{group.items.map(item => <Link key={item.id} href={`${base}/${item.path}`} aria-current={activeBusiness === item.path ? "page" : undefined} data-tip={iconsOnly ? item.label : undefined} onClick={onNavigate}><Icon name={item.icon} size={17} /><span className="nav-label">{item.label}</span></Link>)}</div>) : <Link href={`${base}/settings`} data-tip={iconsOnly ? "Menaxho modulet" : undefined} onClick={onNavigate}><Icon name="settings" size={17} /><span className="nav-label">Menaxho modulet →</span></Link>}</div>
    </details>
    )}
    <hr className={s.divider} />
    {navigation.primary.filter(item => !first.has(item.id) && !business.has(item.id)).map(renderLink)}
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
