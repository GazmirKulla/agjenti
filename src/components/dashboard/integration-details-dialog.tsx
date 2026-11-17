"use client";
import { useDashboardTranslator } from "@/components/dashboard/language";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal/modal";
import styles from "./integration-card.module.css";

/** `closeHref`: the page the dialog sits on (Kanalet by default; Produktet for the business website). */
export function IntegrationDetailsDialog({ slug, name, children, closeHref }: { slug: string; name: string; children: ReactNode; closeHref?: string }) {
  const t = useDashboardTranslator();
  const router = useRouter();
  const close = () => router.replace(closeHref ?? `/b/${slug}/integrations`, { scroll: false });
  return <Modal size="lg" title={`${name} ${t("· Detajet")}`} closeLabel={t("Mbyll detajet")} onClose={close} bodyClassName={styles.dialogContent}>
    {children}
  </Modal>;
}
