"use client";
import Link from "next/link";
import { useState } from "react";
import type { Catalog } from "@/lib/catalogs/model";
import { ListToolbar } from "@/components/dashboard/list-toolbar";
import { RowMenu, type RowMenuItem } from "@/components/dashboard/row-menu";
export const statusLabels: Record<string, string> = {
  pending: "Pa indeksuar",
  indexing: "Duke analizuar",
  review: "Për rishikim",
  ready: "I indeksuar",
  failed: "Analiza dështoi",
};
export function CatalogList({
  catalogs,
  slug,
}: {
  catalogs: Catalog[];
  slug: string;
}) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [index, setIndex] = useState("all"),
    [byTitle, setByTitle] = useState(false);
  const filtered = catalogs.filter(
    (c) =>
      (status === "all" ||
        (status === "active" && c.active) ||
        (status === "inactive" && !c.active)) &&
      (index === "all" || c.index_status === index) &&
      [c.title, ...Object.values(c.metadata).flat()]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const rows = byTitle ? [...filtered].sort((a, b) => a.title.localeCompare(b.title)) : filtered;
  const activeFilters = Number(status !== "all") + Number(index !== "all");
  const filters: RowMenuItem[] = [
    ...([["all", "Të gjitha"], ["active", "Aktive"], ["inactive", "Joaktive"]] as const).map(([value, label]) => ({
      group: "Statusi", label, checked: status === value, onSelect: () => setStatus(value),
    })),
    ...[["all", "Të gjitha"], ...Object.entries(statusLabels)].map(([value, label]) => ({
      group: "Indeksimi", label, checked: index === value, onSelect: () => setIndex(value),
    })),
    ...(activeFilters ? [{ label: "Pastro filtrat", onSelect: () => { setStatus("all"); setIndex("all"); } }] : []),
  ];
  const options: RowMenuItem[] = [
    { group: "Rendit sipas", label: "Përditësuar së fundi", checked: !byTitle, onSelect: () => setByTitle(false) },
    { group: "Rendit sipas", label: "Titulli (A–Z)", checked: byTitle, onSelect: () => setByTitle(true) },
    { group: "Veprime", label: "Shto katalog", href: "#catalog-create" },
  ];
  return (
    <section className="panel catalog-list">
      <h2>Dokumentet e biznesit</h2>
      <ListToolbar subject="katalogët" filters={filters} activeFilters={activeFilters} options={options}>
        <input
          aria-label="Kërko katalog"
          className="field"
          type="search"
          placeholder="Titull, kategori, gjuhë…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </ListToolbar>
      {rows.length > 0 && (
        <ul className="catalog-cards">
          {rows.map((c) => (
            <li key={c.id}>
              <Link className="catalog-card-main" href={`/b/${slug}/catalogs/${c.id}`}>
                <strong>{c.title}</strong>
                <small>
                  {[c.source_type.toUpperCase(), c.metadata.categories?.join(", "), c.metadata.languages?.join(", ")].filter(Boolean).join(" · ")}
                </small>
                <span className="catalog-card-meta">
                  <span className={`catalog-index is-${c.index_status}`}>{statusLabels[c.index_status]}</span>
                  <span>{c.active ? "Aktiv" : "Joaktiv"}</span>
                  <span>{c.updated_at.slice(0, 10)}</span>
                </span>
              </Link>
              <RowMenu label={`Më shumë për ${c.title}`} title={c.title} items={[{ label: "Hap katalogun", href: `/b/${slug}/catalogs/${c.id}` }]} />
            </li>
          ))}
        </ul>
      )}
      <div className="catalog-table">
        <table>
          <thead>
            <tr>
              {[
                "Titulli",
                "Burimi",
                "Kategori",
                "Gjuhë",
                "Tregje",
                "Indeksimi",
                "Statusi",
                "Përditësuar",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/b/${slug}/catalogs/${c.id}`}>{c.title}</Link>
                </td>
                <td data-label="Burimi">{c.source_type.toUpperCase()}</td>
                <td data-label="Kategori">
                  {c.metadata.categories?.join(", ") || "—"}
                </td>
                <td data-label="Gjuhë">
                  {c.metadata.languages?.join(", ") || "—"}
                </td>
                <td data-label="Tregje">
                  {c.metadata.markets?.join(", ") || "—"}
                </td>
                <td data-label="Indeksimi">{statusLabels[c.index_status]}</td>
                <td data-label="Statusi">{c.active ? "Aktiv" : "Joaktiv"}</td>
                <td data-label="Përditësuar">{c.updated_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="catalog-empty">
          {catalogs.length
            ? "Nuk u gjet asnjë katalog me këtë kërkim ose filtër."
            : "Nuk u gjet asnjë katalog. Shto dokumentin e parë për ta përgatitur për Agjentin."}
        </p>
      )}
    </section>
  );
}
