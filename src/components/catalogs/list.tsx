"use client";
import Link from "next/link";
import { useState } from "react";
import type { Catalog } from "@/lib/catalogs/model";
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
    [status, setStatus] = useState("all");
  const rows = catalogs.filter(
    (c) =>
      (status === "all" ||
        (status === "active" && c.active) ||
        (status === "inactive" && !c.active)) &&
      [c.title, ...Object.values(c.metadata).flat()]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <section className="panel">
      <h2>Dokumentet e biznesit</h2>
      <div className="catalog-filters">
        <input
          aria-label="Kërko katalog"
          className="field"
          placeholder="Titull, kategori, gjuhë, treg…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="field"
          aria-label="Statusi"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Të gjitha</option>
          <option value="active">Aktive</option>
          <option value="inactive">Joaktive</option>
        </select>
      </div>
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
        <p>
          Nuk u gjet asnjë katalog. Shto dokumentin e parë për ta përgatitur për
          Agjentin.
        </p>
      )}
    </section>
  );
}
