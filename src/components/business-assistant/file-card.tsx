import Image from "next/image";
import type { ReactNode } from "react";
import { Icon } from "@/components/dashboard/icon";
import "./file-card.css";

export type FileCardItem = { name: string; preview?: string; url?: string; size?: number; status?: string };

/** Shared presentation for a queued attachment, a sent file and an import source. */
export function FileCard({ item, detail, action }: { item: FileCardItem; detail?: string; action?: ReactNode }) {
  const isLink = Boolean(item.url) || /^https?:\/\//.test(item.name);
  const extension = isLink ? "LINK" : item.name.split(".").pop()?.toUpperCase();
  const type = extension && extension.length <= 5 ? extension : "FILE";
  const size = item.size === undefined ? "" : item.size < 1024 * 1024 ? `${Math.max(1, Math.ceil(item.size / 1024))} KB` : `${(item.size / (1024 * 1024)).toFixed(1)} MB`;
  return <div className="attachment-card">
    {item.preview ? <Image className="attachment-thumbnail" unoptimized width={44} height={44} src={item.preview} alt="" /> : <span className={`attachment-icon ${type === "CSV" ? "is-sheet" : ""}`}><Icon name={isLink ? "arrow" : "file"} size={23}/></span>}
    <div className="attachment-copy">
      {item.url ? <a className="attachment-name" title={item.name} href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : <strong className="attachment-name" title={item.name}>{item.name}</strong>}
      <small>{detail ?? [type, size].filter(Boolean).join(" · ")}</small>
      {item.status && <small className="attachment-status" role="status">{item.status}</small>}
    </div>
    {action}
  </div>;
}
