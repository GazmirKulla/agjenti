"use client";
import { LocalizedStatusBadge } from "@/components/dashboard/language";
import { useDashboardTranslator } from "@/components/dashboard/language";
import type { ReactNode } from "react";
import styles from "./integration-card.module.css";

export function IntegrationAccountPanel({ name, status, children }: { name: string; status: string; children: ReactNode }) {
  const t = useDashboardTranslator();
  return <section className={`panel section-pad ${styles.accountPanel}${status !== "connected" ? ` ${styles.unlinked}` : ""}`} aria-label={`${t("Llogaria")} ${name}`}>
    <div className="section-title"><h2>{t("Llogaria")} {name}</h2><LocalizedStatusBadge status={status} /></div>
    {children}
  </section>;
}
