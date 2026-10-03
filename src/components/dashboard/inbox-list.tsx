"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icon";
export type InboxRow = {
  id: string;
  status: string;
  name: string;
  preview: string | null;
  unread: number;
};
export function InboxList({
  rows,
  slug,
  selected,
}: {
  rows: InboxRow[];
  slug: string;
  selected?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const filtered = rows.filter(
    (r) =>
      (filter === "all" ||
        (filter === "unread" ? r.unread > 0 : r.status === filter)) &&
      `${r.name} ${r.preview ?? ""}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <aside className="panel inbox-list">
      <div className="inbox-filters">
        {[
          ["all", "Të gjitha"],
          ["unread", "Të palexuara"],
          ["active", "Në proces"],
          ["completed", "Të mbyllura"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="record-search">
        <Icon name="search" size={17} />
        <input
          aria-label="Kërko në biseda"
          placeholder="Kërko në biseda…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="inbox-rows">
        {filtered.map((r) => (
          <Link
            key={r.id}
            prefetch={false}
            href={`/b/${slug}/inbox/${r.id}`}
            aria-current={selected === r.id ? "page" : undefined}
            className={`inbox-row ${selected === r.id ? "selected" : ""}`}
          >
            <span className="profile-avatar">
              {r.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="inbox-row-copy">
              <strong>{r.name}</strong>
              <small>{r.preview || "Pa mesazh"}</small>
            </span>
            {r.unread > 0 && <span className="unread-badge">{r.unread}</span>}
          </Link>
        ))}
        {!filtered.length && (
          <p className="muted-copy p-5">Nuk ka biseda për këtë filtër.</p>
        )}
      </div>
      <p className="inbox-list-foot">{rows.length} biseda të fundit</p>
    </aside>
  );
}
