import Link from "next/link";
import s from "./health.module.css";

const tabs = [
  { id: "health", href: "/admin/health", label: "Shëndeti" },
  { id: "aftesite", href: "/admin/health/aftesite", label: "Aftësitë e Agjentit" },
  { id: "mesimi", href: "/admin/health/mesimi", label: "Agjenti që mëson" },
] as const;

/** Tabs across Shëndeti i Agjentit: the live figures, the capability report and the learning plan. */
export function HealthTabs({ current }: { current: (typeof tabs)[number]["id"] }) {
  return <nav className={`${s.segments} ${s.tabs}`} aria-label="Shëndeti i Agjentit">
    {tabs.map(t => <Link key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined}>{t.label}</Link>)}
  </nav>;
}
