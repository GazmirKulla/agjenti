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
import { ListToolbar } from "./list-toolbar";
import type { RowMenuItem } from "./row-menu";

export type BrowserRecord = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  detail: ReactNode;
  cells?: ReactNode[];
  /** Values matched against `facets` in client-side lists. */
  facets?: Record<string, string>;
};

export type BrowserFacet = { key: string; label: string; options: { value: string; label: string }[] };

export function RecordBrowser({
  records,
  serverPage,
  hideSearch = false,
  columns,
  placeholder = "Kërko…",
  emptyTitle = "Nuk ka të dhëna",
  emptyDescription = "Të dhënat do të shfaqen këtu pasi t’i shtosh.",
  listTitle = "Të gjitha",
  createForm,
  createLabel = "Shto të re",
  createAsModal = false,
  facets = [],
  sortable = false,
}: {
  /** Client-side filters; ignored for server-paged lists. */
  facets?: BrowserFacet[];
  /** Offers title ordering alongside the original order in client-side lists. */
  sortable?: boolean;
  serverPage?: {
    page: number;
    pageSize: number;
    total: number;
    search: string;
    path: string;
    filters?: Record<string, string>;
  };
  hideSearch?: boolean;
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
  const [opened, setOpened] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [byTitle, setByTitle] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const filtered = serverPage
    ? records
    : records.filter(
        (r) =>
          `${r.title} ${r.subtitle ?? ""}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()) &&
          Object.entries(chosen).every(([key, value]) => r.facets?.[key] === value),
      );
  const matches = byTitle && !serverPage
    ? [...filtered].sort((a, b) => a.title.localeCompare(b.title))
    : filtered;
  const activeFilters = Object.keys(chosen).length;
  const filterItems: RowMenuItem[] = serverPage
    ? []
    : [
        ...facets.flatMap((facet) =>
          [{ value: "", label: "Të gjitha" }, ...facet.options].map((option) => ({
            group: facet.label,
            label: option.label,
            checked: (chosen[facet.key] ?? "") === option.value,
            onSelect: () => {
              setChosen((current) => {
                const next = { ...current };
                if (option.value) next[facet.key] = option.value;
                else delete next[facet.key];
                return next;
              });
              setPage(0);
            },
          })),
        ),
        ...(activeFilters
          ? [{ label: "Pastro filtrat", onSelect: () => { setChosen({}); setPage(0); } }]
          : []),
      ];
  const optionItems: RowMenuItem[] =
    sortable && !serverPage
      ? [
          { group: "Rendit sipas", label: "Më të rejat", checked: !byTitle, onSelect: () => setByTitle(false) },
          { group: "Rendit sipas", label: "Emri (A–Z)", checked: byTitle, onSelect: () => setByTitle(true) },
        ]
      : [];
  function open(id: string) {
    setSelected(id);
    setOpened(true);
    if (!createAsModal) setCreating(false);
  }
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(matches.length / 10) - 1),
  );
  const rows = serverPage
    ? matches
    : matches.slice(safePage * 10, safePage * 10 + 10);
  function pageHref(page: number) {
    return `${serverPage!.path}?${new URLSearchParams({ ...serverPage!.filters, page: String(page), q: serverPage!.search })}`;
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

  const detailOpen = opened || (creating && !createAsModal);
  useEffect(() => {
    if (!detailOpen) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dialogRef.current?.open || !window.matchMedia("(max-width: 760px)").matches) return;
      setOpened(false);
      setCreating(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [detailOpen]);

  const formWithClose =
    createAsModal && isValidElement(createForm)
      ? cloneElement(createForm as ReactElement<{ onSuccess?: () => void }>, {
          onSuccess: () => setCreating(false),
        })
      : createForm;

  return (
    <div className={`record-browser ${columns ? "table-browser" : ""}${detailOpen ? " is-detail-open" : ""}`}>
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
        {hideSearch && !filterItems.length && !optionItems.length ? null : (
        <ListToolbar subject="listën" filters={filterItems} activeFilters={activeFilters} options={optionItems}>
        {hideSearch ? null : serverPage ? (
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
        </ListToolbar>
        )}
        {rows.length ? (
          columns ? (
            <>
            <ul className="record-cards">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" className="record-card" onClick={() => open(r.id)}>
                    <span className="record-card-copy">
                      <strong>{r.title}</strong>
                      {r.subtitle && <small>{r.subtitle}</small>}
                      {r.cells?.length ? (
                        <span className="record-card-meta">
                          {r.cells.map((cell, i) => <span key={i}>{cell}</span>)}
                        </span>
                      ) : null}
                    </span>
                    <span className="record-card-chevron" aria-hidden>›</span>
                  </button>
                </li>
              ))}
            </ul>
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
                          onClick={() => open(r.id)}
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
            </>
          ) : (
            <div className="record-items">
              {rows.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={`record-item ${active?.id === r.id && !(creating && !createAsModal) ? "selected" : ""}`}
                  onClick={() => open(r.id)}
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
              serverPage?.search || query || activeFilters
                ? "Nuk u gjet asnjë rezultat"
                : emptyTitle
            }
            description={
              serverPage?.search || query || activeFilters
                ? "Provo një emër, term ose filtër tjetër."
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
        <button
          type="button"
          className="record-detail-back"
          onClick={() => {
            setOpened(false);
            setCreating(false);
          }}
        >
          ‹ Kthehu te lista
        </button>
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
