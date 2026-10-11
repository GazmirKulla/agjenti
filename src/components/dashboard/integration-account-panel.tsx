import type { ReactNode } from "react";
import { StatusBadge } from "./ui";
import styles from "./integration-card.module.css";

export function IntegrationAccountPanel({ name, status, children }: { name: string; status: string; children: ReactNode }) {
  return <section className={`panel section-pad ${styles.accountPanel}${status !== "connected" ? ` ${styles.unlinked}` : ""}`} aria-label={`Llogaria ${name}`}>
    <div className="section-title"><h2>Llogaria {name}</h2><StatusBadge status={status} /></div>
    {children}
  </section>;
}
