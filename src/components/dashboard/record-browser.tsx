"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { EmptyState } from "./ui";
export type BrowserRecord = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  detail: ReactNode;
  cells?: ReactNode[];
};
export function RecordBrowser({
  records,
  columns,
  placeholder = "Kërko…",
  emptyTitle = "Nuk ka të dhëna",
  emptyDescription = "Të dhënat do të shfaqen këtu pasi t’i shtosh.",
  listTitle = "Të gjitha",
  createForm,
  createLabel = "Shto të re",
}: {
  records: BrowserRecord[];
  columns?: string[];
  placeholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  listTitle?: string;
  createForm?: ReactNode;
  createLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(records[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);
  const matches = records.filter((r) =>
    `${r.title} ${r.subtitle ?? ""}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(matches.length / 10) - 1),
  );
  const rows = matches.slice(safePage * 10, safePage * 10 + 10);
  const active = rows.find((r) => r.id === selected) ?? rows[0];
  return (
    <div className={`record-browser ${columns ? "table-browser" : ""}`}>
      <section className="panel record-list">
        <div className="record-toolbar">
          <h2>
            {listTitle} <span>{records.length}</span>
          </h2>
          {createForm && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreating(!creating)}
            >
              {creating ? "Mbyll" : `+ ${createLabel}`}
            </button>
          )}
        </div>
        <div className="record-search">
          <Icon name="search" size={18} />
          <input
            aria-label={placeholder}
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        {rows.length ? (
          columns ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{columns[0]}</th>
                    {columns.slice(1).map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={
                        active?.id === r.id && !creating ? "selected" : ""
                      }
                    >
                      <td>
                        <button
                          type="button"
                          className="row-select"
                          onClick={() => {
                            setSelected(r.id);
                            setCreating(false);
                          }}
                        >
                          <strong>{r.title}</strong>
                          <small>{r.subtitle}</small>
                        </button>
                      </td>
                      {r.cells?.map((cell, i) => (
                        <td key={i}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="record-items">
              {rows.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={`record-item ${active?.id === r.id && !creating ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(r.id);
                    setCreating(false);
                  }}
                  aria-pressed={active?.id === r.id && !creating}
                >
                  <span className="record-monogram">
                    {r.title.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="record-item-copy">
                    <strong>{r.title}</strong>
                    <small>{r.subtitle}</small>
                  </span>
                  {r.badge}
                </button>
              ))}
            </div>
          )
        ) : (
          <EmptyState
            title={query ? "Nuk u gjet asnjë rezultat" : emptyTitle}
            description={
              query ? "Provo një emër ose term tjetër." : emptyDescription
            }
          />
        )}
        <div className="pagination">
          <span>
            {matches.length ? safePage * 10 + 1 : 0}–
            {Math.min((safePage + 1) * 10, matches.length)} nga {matches.length}
          </span>
          <button
            type="button"
            aria-label="Faqja e mëparshme"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            ‹
          </button>
          <span className="page-number">{safePage + 1}</span>
          <button
            type="button"
            aria-label="Faqja tjetër"
            disabled={(safePage + 1) * 10 >= matches.length}
            onClick={() => setPage(safePage + 1)}
          >
            ›
          </button>
        </div>
      </section>
      <section className="panel record-detail">
        {creating ? (
          <>
            <h2 className="detail-title">{createLabel}</h2>
            {createForm}
          </>
        ) : active ? (
          active.detail
        ) : createForm ? (
          <>
            <h2 className="detail-title">{createLabel}</h2>
            {createForm}
          </>
        ) : (
          <EmptyState
            title="Detajet"
            description="Zgjidh një rresht për të parë më shumë."
          />
        )}
      </section>
    </div>
  );
}
