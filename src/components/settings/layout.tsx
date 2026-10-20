"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useDashboardTranslator } from "@/components/dashboard/language";
import { settingsGroups } from "@/lib/dashboard/navigation/settings";
import s from "./settings.module.css";

export function SettingsLayout({ slug, name, children }: { slug: string; name: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useDashboardTranslator();
  const base = `/b/${slug}`;
  const navigation = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const sync = () => { if (navigation.current) navigation.current.open = !media.matches; };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [pathname]);
  return <section className={s.workspace} aria-label={t("Cilësimet")}>
    <header className={s.heading}><div><h1>{t("Cilësimet")}</h1><p>{name}</p></div><Link href={base}>← {t("Kthehu te asistenti")}</Link></header>
    <div className={s.body}>
      <details ref={navigation} className={s.navigation} open key={pathname}>
        <summary>{t("Seksionet e cilësimeve")}</summary>
        <nav aria-label={t("Seksionet e cilësimeve")}>
          {settingsGroups.map(group => <section key={group.label}><h2>{t(group.label)}</h2>{group.items.map(item => {
            const href = `${base}/settings/${item.path}`;
            return <Link key={item.path} href={href} aria-current={pathname === href ? "page" : undefined}>{t(item.label)}</Link>;
          })}</section>)}
        </nav>
      </details>
      <div className={s.content}>{children}</div>
    </div>
  </section>;
}
