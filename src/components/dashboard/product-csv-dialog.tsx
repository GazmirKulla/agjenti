"use client";

import type { ReactNode } from "react";
import { Modal } from "@/components/modal/modal";

export function ProductCsvDialog({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  return <Modal size="md" className="csv-dialog" bodyClassName="csv-dialog-content" title={title} onClose={onClose}
    closeLabel="Mbyll detajet e CSV-së" footer={footer}>
    {children}
  </Modal>;
}
