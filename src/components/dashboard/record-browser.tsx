"use client";
import Link from "next/link";
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
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
  serverPage,
  columns,
  placeholder = "Kërko…",
  emptyTitle = "Nuk ka të dhëna",
  emptyDescription = "Të dhënat do të shfaqen këtu pasi t’i shtosh.",
  listTitle = "Të gjitha",
  createForm,
  createLabel = "Shto të re",
  createAsModal = false,
}: {
  serverPage?: {
    page: number;
    pageSize: number;
    total: number;
    search: string;
    path: string;
  };
  records: BrowserRecord[];
  columns?: string[];
  placeholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  listTitle?: string;
  createForm?: ReactNode;
  createLabel?: string;
  /** Kur true, forma e krijimit hapet në modal, jo në panelin e detajeve. */
  createAsModal?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(records[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const matches = serverPage
    ? records
    : records.filter((r) =>
        `${r.title} ${r.subtitle ?? ""}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      );
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(matches.length / 10) - 1),
  );
  const rows = serverPage
    ? matches
    : matches.slice(safePage * 10, safePage * 10 + 10);
  function pageHref(page: number) {
    return `${serverPage!.path}?${new URLSearchParams({ page: String(page), q: serverPage!.search })}`;
  }
  const active = rows.find((r) => r.id === selected) ?? rows[0];

  useEffect(() => {
    if (!createAsModal) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (creating) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [creating, createAsModal]);

  const formWithClose =
    createAsModal && isValidElement(createForm)
      ? cloneElement(createForm as ReactElement<{ onSuccess?: () => void }>, {
          onSuccess: () => setCreating(false),
        })
      : createForm;

  return (
    <div className={`record-browser ${columns ? "table-browser" : ""}`}>
      <section className="panel record-list">
        <div className="record-toolbar">
          <h2>
            {listTitle} <span>{serverPage?.total ?? records.length}</span>
          </h2>
          {createForm && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreating(!creating)}
            >
              {creating && !createAsModal ? "Mbyll" : `+ ${createLabel}`}
            </button>
          )}
        </div>
        {serverPage ? (
          <form
            action={serverPage.path}
            className="record-search"
            key={serverPage.search}
          >
            <Icon name="search" size={18} />
            <input
              name="q"
              aria-label={placeholder}
              placeholder={placeholder}
              defaultValue={serverPage.search}
              maxLength={100}
            />
            <button className="btn btn-ghost" type="submit">
              Kërko
            </button>
          </form>
        ) : (
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
        )}
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
                        active?.id === r.id && !(creating && !createAsModal)
                          ? "selected"
                          : ""
                      }
                    >
                      <td>
                        <button
                          type="button"
                          className="row-select"
                          onClick={() => {
                            setSelected(r.id);
                            if (!createAsModal) setCreating(false);
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
                  className={`record-item ${active?.id === r.id && !(creating && !createAsModal) ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(r.id);
                    if (!createAsModal) setCreating(false);
                  }}
                  aria-pressed={
                    active?.id === r.id && !(creating && !createAsModal)
                  }
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
            title={
              serverPage?.search || query
                ? "Nuk u gjet asnjë rezultat"
                : emptyTitle
            }
            description={
              serverPage?.search || query
                ? "Provo një emër ose term tjetër."
                : emptyDescription
            }
          />
        )}
        {serverPage ? (
          <div className="pagination">
            <span>
              {rows.length
                ? (serverPage.page - 1) * serverPage.pageSize + 1
                : 0}
              –
              {rows.length
                ? (serverPage.page - 1) * serverPage.pageSize + rows.length
                : 0}{" "}
              nga {serverPage.total}
            </span>
            {serverPage.page > 1 && (
              <Link
                prefetch={false}
                href={pageHref(serverPage.page - 1)}
                aria-label="Faqja e mëparshme"
              >
                ‹
              </Link>
            )}
            <span className="page-number">{serverPage.page}</span>
            {serverPage.page * serverPage.pageSize < serverPage.total && (
              <Link
                prefetch={false}
                href={pageHref(serverPage.page + 1)}
                aria-label="Faqja tjetër"
              >
                ›
              </Link>
            )}
          </div>
        ) : (
          <div className="pagination">
            <span>
              {matches.length ? safePage * 10 + 1 : 0}–
              {Math.min((safePage + 1) * 10, matches.length)} nga{" "}
              {matches.length}
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
        )}
      </section>
      <section
        className="panel record-detail"
        key={
          creating && !createAsModal ? "create" : (active?.id ?? "empty")
        }
      >
        {creating && !createAsModal ? (
          <>
            <h2 className="detail-title">{createLabel}</h2>
            {createForm}
          </>
        ) : active ? (
          active.detail
        ) : createForm && !createAsModal ? (
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
      {createAsModal && createForm ? (
        <dialog
          ref={dialogRef}
          className="record-create-dialog"
          onClose={() => setCreating(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setCreating(false);
          }}
        >
          <div className="record-create-dialog-body">
            <header className="record-create-dialog-head">
              <h2>{createLabel}</h2>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label="Mbyll"
                onClick={() => setCreating(false)}
              >
                ✕
              </button>
            </header>
            {creating ? formWithClose : null}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
