"use client";
import { attributeSummary, availabilityLabels, type KindField } from "@/lib/items/kinds";
import { attributeFields, type BusinessField } from "@/lib/items/fields";
import { useCatalogAssistantContext } from "@/components/business-assistant/workspace";
import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  catalogFilter,
  catalogStatus,
  isMapped,
  type ProductRow,
  type CatalogField,
  type Option,
} from "@/lib/products/catalog";
import { bulkConfigureProducts } from "@/lib/products/actions";
import { updateCatalogField } from "@/lib/products/inline-actions";
import { productMoney as money } from "@/lib/products/catalog";
import { entityWorkflowHref } from "@/components/workflows/entity-flow-link";

import { ProductBusinessWorkflow } from "./business-workflow";
import { useManualOperation } from "@/components/dashboard/operation-button";
import { RowMenu, type RowMenuItem } from "@/components/dashboard/row-menu";
import { Icon } from "@/components/dashboard/icon";

const VIEW_KEY = "agjenti.products.view";
const PAGE_SIZE = 10;
/** Page numbers around the current one, with gaps (0) when there are many pages. */
function pageNumbers(current: number, last: number): number[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const around = [current - 1, current, current + 1].filter(n => n > 1 && n < last);
  const pages = [1, ...around, last];
  return pages.flatMap((n, i) => (i && n - pages[i - 1] > 1 ? [0, n] : [n]));
}
const STATUS_LABEL: Record<string, string> = {
  archived: "I arkivuar",
  active: "Aktiv",
  draft: "Draft",
  unlinked: "I palidhur",
};
const STATUS_FILTERS = [
  ["all", "Të gjitha"],
  ["active", "Aktive"],
  ["archived", "Të arkivuara"],
  ["draft", "Draft"],
  ["unlinked", "Të palidhura"],
  ["imports", "Katalog i jashtëm"],
] as const;
const SORTS = [
  ["newest", "Më të rejat"],
  ["name", "Emri (A–Z)"],
  ["price", "Çmimi (nga më i ulëti)"],
] as const;

/** Under the name: the kind's key fields (e.g. "Shitje · Tiranë · 120 m²"), or the SKU for plain products. */
function itemSubline(p: ProductRow, extra: KindField[] = []) {
  const variants = p.variants?.filter(v => v.is_active).length ?? 0;
  const summary = [attributeSummary(p.item_kind ?? "product", p.attributes, extra), variants ? `${variants} variante` : ""].filter(Boolean).join(" · ");
  if (summary) return summary;
  return p.sku ? `SKU: ${p.sku}` : p.source === "linked" ? "Katalog i lidhur" : "Pa SKU";
}

export function ProductCatalog({
  slug,
  products,
  types,
  workflows,
  mapping = false,
  fields = [],
}: {
  slug: string;
  products: ProductRow[];
  types: Option[];
  workflows: Option[];
  mapping?: boolean;
  /** The business's own product fields, shown under each name. */
  fields?: BusinessField[];
}) {
  const extra = attributeFields(fields);
  const [query, setQuery] = useState("");
  const defaultFilter = mapping ? "unlinked" : "all";
  const [filter, setFilter] = useState(defaultFilter);
  const [typeFilter, setTypeFilter] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  // Table or cards on wide screens; phones always get the card list.
  const [view, setView] = useState<"table" | "grid">("table");
  useEffect(() => {
    try { if (localStorage.getItem(VIEW_KEY) === "grid") setView("grid"); } catch { /* storage blocked */ }
  }, []);
  const chooseView = (next: "table" | "grid") => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* storage blocked */ }
  };
  useCatalogAssistantContext({
    searchQuery: query,
    filters: { status: filter, ...(typeFilter ? { type: typeFilter } : {}) },
    selectedEntityIds: selected,
    selectionLabel: selected.length === 1 ? products.find(product => product.id === selected[0])?.name : selected.length ? `${selected.length} produkte të zgjedhura` : undefined,
  });
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState("");
  const [typeId, setTypeId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [rowUpdates, setRowUpdates] = useState<Record<string, ProductRow>>({});
  const [savingRows, setSavingRows] = useState<
    Record<string, { field: CatalogField; value: string | boolean | null }>
  >({});
  const [rowFeedback, setRowFeedback] = useState<
    Record<string, { error?: string; success?: string }>
  >({});
  const [configId, setConfigId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const configDialog = useRef<HTMLDialogElement>(null);
  const bulkDialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(new Set<string>());
  const hasSavingRows = Object.keys(savingRows).length > 0;
  const catalogProducts = useMemo(
    () =>
      products.map((product) => {
        const edited = rowUpdates[product.id];
        return edited &&
          Date.parse(edited.updated_at ?? "") >
            Date.parse(product.updated_at ?? "")
          ? edited
          : product;
      }),
    [products, rowUpdates],
  );
  const router = useRouter();
  const filtered = useMemo(
    () => catalogFilter(catalogProducts, query, filter, typeFilter, sort),
    [catalogProducts, query, filter, typeFilter, sort],
  );
  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, maxPage);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const configProduct =
    catalogProducts.find((p) => p.id === configId) ?? null;
  const removal = useManualOperation(slug, "product.delete");
  // Multiple delete goes through the same reviewed server operation as the assistant:
  // the server re-resolves each ID, archives products with history, and previews before confirming.
  const bulkRemoval = useManualOperation(slug, "product.remove");
  const removeMany = (ids: string[]) => void bulkRemoval.prepare({ scope: "ids", ids });
  const activeFilters = Number(filter !== defaultFilter) + Number(Boolean(typeFilter));
  const filterItems: RowMenuItem[] = [
    ...STATUS_FILTERS.map(([value, label]) => ({
      group: "Statusi", label, checked: filter === value,
      onSelect: () => { setFilter(value); setPage(1); },
    })),
    ...(types.length
      ? [{ id: "", name: "Të gjitha llojet" }, ...types].map((type) => ({
          group: "Lloji", label: type.name, checked: typeFilter === type.id,
          onSelect: () => { setTypeFilter(type.id); setPage(1); },
        }))
      : []),
    ...(activeFilters
      ? [{ label: "Pastro filtrat", onSelect: () => { setFilter(defaultFilter); setTypeFilter(""); setPage(1); } }]
      : []),
  ];
  const sortItems: RowMenuItem[] = SORTS.map(([value, label]) => ({
    group: "Rendit sipas", label, checked: sort === value,
    onSelect: () => { setSort(value); setPage(1); },
  }));
  const moreItems: RowMenuItem[] = [
    { group: "Shto", label: "Ngarko CSV", href: `/b/${slug}/products/new?method=csv` },
    { group: "Shto", label: "Nga Instagram", href: `/b/${slug}/products/new?method=instagram` },
    { group: "Shto", label: "Importo / lidh katalog", href: `/b/${slug}/products/imports` },
    {
      group: "Veprime",
      label: `Konfiguro produktet e kësaj faqeje (${shown.length})`,
      disabled: !shown.length,
      onSelect: () => { setSelected(shown.map((p) => p.id)); setBulkOpen(true); },
    },
    {
      group: "Veprime",
      label: `Fshi produktet e kësaj faqeje (${shown.length})`,
      danger: true,
      disabled: !shown.length || bulkRemoval.busy,
      onSelect: () => removeMany(shown.map((p) => p.id)),
    },
    ...(filtered.length > shown.length
      ? [{
          group: "Veprime",
          label: filtered.length > 100
            ? `Fshi të gjitha sipas filtrit (${filtered.length}, maks. 100)`
            : `Fshi të gjitha sipas filtrit (${filtered.length})`,
          danger: true,
          disabled: filtered.length > 100 || bulkRemoval.busy,
          onSelect: () => removeMany(filtered.map((p) => p.id)),
        }]
      : []),
  ];
  function rowActions(p: ProductRow): RowMenuItem[] {
    return [
      { label: "Hap produktin", href: `/b/${slug}/products/${p.id}` },
      { label: "Konfiguro llojin dhe procesin", onSelect: () => setConfigId(p.id) },
      ...(p.visual_workflow
        ? [{ label: `Hap procesin: ${p.visual_workflow.name}`, href: entityWorkflowHref(slug, "product", p.id, p.visual_workflow.flowId) }]
        : []),
      { label: "Fshi produktin", danger: true, disabled: removal.busy, onSelect: () => void removal.prepare({ id: p.id }) },
    ];
  }

  useEffect(() => {
    const dialog = configDialog.current;
    if (!dialog) return;
    if (configId) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [configId]);

  useEffect(() => {
    const dialog = bulkDialog.current;
    if (!dialog) return;
    if (bulkOpen) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [bulkOpen]);

  function apply(mode: "map" | "activate" | "draft") {
    if (hasSavingRows) return;
    setNotice("");
    start(async () => {
      try {
        const result = await bulkConfigureProducts(slug, {
          ids: selected,
          productTypeId: typeId || null,
          workflowId: workflowId || null,
          mode,
        });
        setNotice(result.error ?? result.success ?? "");
        if (!result.error) {
          setSelected([]);
          setBulkOpen(false);
          setWorkflowId("");
          router.refresh();
        }
      } catch {
        setNotice("Ndryshimet nuk u ruajtën. Provo përsëri.");
      }
    });
  }

  async function editRow(
    product: ProductRow,
    field: CatalogField,
    value: string | boolean | null,
  ) {
    if (pending || inFlight.current.has(product.id) || product[field] === value)
      return;
    inFlight.current.add(product.id);
    setSavingRows((current) => ({
      ...current,
      [product.id]: { field, value },
    }));
    setRowFeedback((current) => ({ ...current, [product.id]: {} }));
    try {
      const result = await updateCatalogField(slug, {
        id: product.id,
        field,
        value,
        updatedAt: product.updated_at ?? "",
      });
      setRowFeedback((current) => ({
        ...current,
        [product.id]: { error: result.error, success: result.success },
      }));
      if (!result.error) {
        if (!result.product) setRowUpdates(current => { const next = { ...current }; delete next[product.id]; return next; });
        if (result.product) setRowUpdates((current) => ({
          ...current,
          [product.id]: result.product!,
        }));
        setNotice(`${product.name}: ${result.success ?? "U ruajt."}`);
        router.refresh();
      }
    } catch {
      setRowFeedback((current) => ({
        ...current,
        [product.id]: { error: "Ndryshimi nuk u ruajt. Provo përsëri." },
      }));
    } finally {
      inFlight.current.delete(product.id);
      setSavingRows((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
    }
  }

  return (
    <div className="products-workspace">
      {mapping && (
        <div className="catalog-notice">
          <strong>
            {
              catalogProducts.filter((p) => catalogStatus(p) === "unlinked")
                .length
            }{" "}
            produkte të palidhura
          </strong>
          <p>
            Hap «Konfiguro» te çdo produkt për llojin dhe rrjedhën e tij. Rrjedhat lidhen drejtpërdrejt te Workflow.
          </p>
        </div>
      )}
      <section className="panel product-catalog">
        <div className="catalog-toolbar" role="toolbar" aria-label="Lista e produkteve">
          <RowMenu
            label="Filtro produktet"
            title="Filtro produktet"
            items={filterItems}
            triggerClassName="btn btn-ghost catalog-tool"
            trigger={<>
              <svg aria-hidden viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
              <span>Filtra</span>
              {activeFilters > 0 && <span className="catalog-tool-count" aria-label={`${activeFilters} aktivë`}>{activeFilters}</span>}
            </>}
          />
          <RowMenu
            label="Rendit produktet"
            title="Rendit sipas"
            items={sortItems}
            triggerClassName="btn btn-ghost catalog-tool"
            trigger={<>
              <svg aria-hidden viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>
              <span>Rendit</span>
            </>}
          />
          <RowMenu
            label="Më shumë veprime"
            title="Më shumë"
            items={moreItems}
            triggerClassName="btn btn-ghost catalog-tool"
            trigger={<>
              <svg aria-hidden viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
              <span>Më shumë</span>
            </>}
          />
          <input
            className="field catalog-search"
            type="search"
            aria-label="Kërko produkte"
            placeholder="Kërko emër ose kod…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <div className="catalog-view-toggle" role="group" aria-label="Pamja e listës">
            <button type="button" className={view === "table" ? "is-active" : ""} aria-pressed={view === "table"} aria-label="Tabelë" title="Tabelë" onClick={() => chooseView("table")}>
              <svg aria-hidden viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <button type="button" className={view === "grid" ? "is-active" : ""} aria-pressed={view === "grid"} aria-label="Karta" title="Karta" onClick={() => chooseView("grid")}>
              <svg aria-hidden viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
            </button>
          </div>
        </div>
        {notice && (
          <p role="status" className="catalog-notice">
            {notice}
          </p>
        )}
        {selected.length > 0 && !bulkOpen && (
          <div className="catalog-bulk-bar" role="region" aria-label="Produktet e zgjedhura">
            <strong>{selected.length} të zgjedhura</strong>
            <button type="button" className="btn btn-ghost" disabled={pending || hasSavingRows} onClick={() => apply("activate")}>{mapping ? "Lidh dhe aktivizo" : "Aktivizo"}</button>
            <button type="button" className="btn btn-ghost" disabled={pending || hasSavingRows} onClick={() => apply("draft")}>Kalo në draft</button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setBulkOpen(true)}>Lloji / procesi</button>
            <button type="button" className="btn btn-ghost catalog-bulk-danger" disabled={bulkRemoval.busy} onClick={() => removeMany(selected)}>Fshi</button>
            <button type="button" className="catalog-bulk-clear" onClick={() => setSelected([])}>Pastro</button>
          </div>
        )}
        {shown.length > 0 && <p className="catalog-count">{filtered.length} produkte</p>}
        {shown.length > 0 && (
          <div className="product-cards">
            <ul>
              {shown.map((p) => {
                const status = catalogStatus(p);
                return (
                  <li key={p.id} className="product-card" aria-busy={Boolean(savingRows[p.id])}>
                    <Link className="product-card-main" href={`/b/${slug}/products/${p.id}`}>
                      {p.image_url ? (
                        <img src={p.image_url} alt="" loading="lazy" />
                      ) : (
                        <span className="product-no-image" aria-hidden><Icon name="products" size={22} /></span>
                      )}
                      <span className="product-card-text">
                        <strong>{p.name}</strong>
                        <small>{itemSubline(p, extra)}</small>
                        <span className="product-card-meta">
                          <span>{money(p.price_amount, p.currency, { mode: p.price_mode, max: p.price_max, unit: p.price_unit })}</span>
                          <span className={`product-status is-${status}`}>{STATUS_LABEL[status] ?? status}</span>
                          {p.availability && p.availability !== "available" && <span className={`product-availability is-${p.availability}`}>{availabilityLabels[p.availability]}</span>}
                        </span>
                      </span>
                    </Link>
                    <RowMenu label={`Më shumë për ${p.name}`} title={p.name} items={rowActions(p)} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {shown.length > 0 && view === "grid" && (
          <ul className="product-grid">
            {shown.map((p) => {
              const status = catalogStatus(p);
              const checked = selected.includes(p.id);
              return (
                <li key={p.id} className={`product-tile${checked ? " is-selected" : ""}`} aria-busy={Boolean(savingRows[p.id])}>
                  <input className="product-tile-check" type="checkbox" aria-label={`Zgjidh ${p.name}`} checked={checked}
                    onChange={(e) => setSelected(current => e.target.checked ? [...current, p.id] : current.filter(id => id !== p.id))} />
                  <Link className="product-tile-main" href={`/b/${slug}/products/${p.id}`}>
                    <span className="product-tile-photo">
                      {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <Icon name="products" size={34} />}
                    </span>
                    <strong>{p.name}</strong>
                    <small>{itemSubline(p, extra)}</small>
                    <span className="product-card-meta">
                      <span>{money(p.price_amount, p.currency, { mode: p.price_mode, max: p.price_max, unit: p.price_unit })}</span>
                      <span className={`product-status is-${status}`}>{STATUS_LABEL[status] ?? status}</span>
                      {p.availability && p.availability !== "available" && <span className={`product-availability is-${p.availability}`}>{availabilityLabels[p.availability]}</span>}
                    </span>
                  </Link>
                  <span className="product-tile-menu"><RowMenu label={`Më shumë për ${p.name}`} title={p.name} items={rowActions(p)} /></span>
                </li>
              );
            })}
          </ul>
        )}
        {shown.length > 0 && view === "table" && (
        <div className="product-table-scroll">
          <table className="product-table">
            <thead>
              <tr>
                <th className="product-table-check">
                  <input type="checkbox" aria-label="Zgjidh të gjitha në këtë faqe"
                    checked={shown.every(p => selected.includes(p.id))}
                    onChange={(e) => setSelected(current => e.target.checked
                      ? [...new Set([...current, ...shown.map(p => p.id)])]
                      : current.filter(id => !shown.some(p => p.id === id)))} />
                </th>
                <th>Produkti</th>
                <th>Çmimi</th>
                <th>Statusi</th>
                <th>
                  <span className="sr-only">Veprime</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const status = catalogStatus(p);
                const checked = selected.includes(p.id);
                return (
                  <tr key={p.id} aria-busy={Boolean(savingRows[p.id])} className={checked ? "is-selected" : undefined}>
                    <td className="product-table-check">
                      <input type="checkbox" aria-label={`Zgjidh ${p.name}`} checked={checked}
                        onChange={(e) => setSelected(current => e.target.checked ? [...current, p.id] : current.filter(id => id !== p.id))} />
                    </td>
                    <td>
                      <Link
                        className="product-cell"
                        href={`/b/${slug}/products/${p.id}`}
                      >
                        {p.image_url ? (
                          <img src={p.image_url} alt="" loading="lazy" />
                        ) : (
                          <span className="product-no-image" aria-hidden><Icon name="products" size={20} /></span>
                        )}
                        <span>
                          <strong>{p.name}</strong>
                          <small>{itemSubline(p, extra)}</small>
                        </span>
                      </Link>
                      {p.visual_workflow && <Link className="catalog-flow-name" href={entityWorkflowHref(slug, "product", p.id, p.visual_workflow.flowId)}>{p.visual_workflow.name} ↗</Link>}
                    </td>
                    <td className="product-table-price">{money(p.price_amount, p.currency, { mode: p.price_mode, max: p.price_max, unit: p.price_unit })}</td>
                    <td>
                      <span className={`product-status is-${status}`}>
                        {STATUS_LABEL[status] ?? status}
                      </span>
                      {p.availability && p.availability !== "available" && <span className={`product-availability is-${p.availability}`}>{availabilityLabels[p.availability]}</span>}
                    </td>
                    <td>
                      <RowMenu label={`Më shumë për ${p.name}`} items={rowActions(p)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        {!shown.length && (
          <div className="empty-state">
            <h3>
              {products.length
                ? "Nuk u gjetën produkte"
                : "Ende nuk ka produkte"}
            </h3>
            <p>
              {products.length
                ? "Ndrysho kërkimin ose filtrin."
                : "Shto produktin e parë për ta përdorur Agjenti."}
            </p>
            <Link
              className="btn btn-primary"
              href={`/b/${slug}/products/new`}
            >
              Shto produkt
            </Link>
          </div>
        )}
        <footer className="catalog-pagination">
          <span>
            {filtered.length
              ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)}`
              : "0"}{" "}
            nga {filtered.length} produkte
          </span>
          {maxPage > 1 && (
            <nav className="catalog-pages" aria-label="Faqet e produkteve">
              <button type="button" aria-label="Faqja e mëparshme" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button>
              {pageNumbers(currentPage, maxPage).map((n, i) => n === 0
                ? <span key={`gap-${i}`} aria-hidden>…</span>
                : <button key={n} type="button" className={n === currentPage ? "is-current" : ""} aria-current={n === currentPage ? "page" : undefined} onClick={() => setPage(n)}>{n}</button>)}
              <button type="button" aria-label="Faqja pasuese" disabled={currentPage >= maxPage} onClick={() => setPage(currentPage + 1)}>›</button>
            </nav>
          )}
        </footer>
      </section>
      {removal.dialog}
      {bulkRemoval.dialog}

      <dialog
        ref={configDialog}
        className="record-create-dialog catalog-dialog"
        aria-labelledby="catalog-config-title"
        onClose={() => setConfigId(null)}
        onClick={(e) => {
          if (e.target === configDialog.current) setConfigId(null);
        }}
      >
        {configProduct && (
          <div className="record-create-dialog-body">
            <header className="record-create-dialog-head">
              <div>
                <h2 id="catalog-config-title">Konfiguro</h2>
                <p className="muted-copy">{configProduct.name}</p>
              </div>
              <button
                className="btn btn-ghost"
                type="button"
                aria-label="Mbyll"
                onClick={() => setConfigId(null)}
              >
                ×
              </button>
            </header>
            <div className="catalog-dialog-fields">
              <label className="form-label">
                Lloji
                <select
                  className="field"
                  value={
                    savingRows[configProduct.id]?.field === "product_type_id"
                      ? String(savingRows[configProduct.id].value ?? "")
                      : (configProduct.product_type_id ?? "")
                  }
                  disabled={
                    pending || Boolean(savingRows[configProduct.id])
                  }
                  onChange={(event) =>
                    void editRow(
                      configProduct,
                      "product_type_id",
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">Pa lloj</option>
                  {configProduct.product_type_id &&
                    !types.some(
                      (type) => type.id === configProduct.product_type_id,
                    ) && (
                      <option value={configProduct.product_type_id} disabled>
                        Lloji aktual (joaktiv)
                      </option>
                    )}
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </label>
              <ProductBusinessWorkflow slug={slug} workflow={configProduct.business_workflow} product={configProduct} />
              <details open={Boolean(configProduct.workflow_id)}><summary>Proces i posaçëm (opsional)</summary><label className="form-label">
                Procesi pas zgjedhjes së produktit
                <select
                  className="field"
                  value={
                    savingRows[configProduct.id]?.field === "workflow_id"
                      ? String(savingRows[configProduct.id].value ?? "")
                      : (configProduct.workflow_id ?? "")
                  }
                  disabled={
                    pending || Boolean(savingRows[configProduct.id])
                  }
                  onChange={(event) =>
                    void editRow(
                      configProduct,
                      "workflow_id",
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">{configProduct.visual_workflow || configProduct.visual_draft ? "Ruaj procesin vizual ekzistues" : "Përdor workflow-in kryesor"}</option>
                  {configProduct.workflow_id &&
                    !workflows.some(
                      (workflow) => workflow.id === configProduct.workflow_id,
                    ) && (
                      <option value={configProduct.workflow_id} disabled>
                        Workflow aktual
                      </option>
                    )}
                  {workflows.filter(w => w.id).map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label></details>
              <label className="form-label">
                Statusi
                <select
                  className="field"
                  value={
                    (
                      savingRows[configProduct.id]?.field === "is_active"
                        ? savingRows[configProduct.id].value
                        : configProduct.is_active
                    )
                      ? "active"
                      : "draft"
                  }
                  disabled={
                    pending || Boolean(savingRows[configProduct.id])
                  }
                  onChange={(event) =>
                    void editRow(
                      configProduct,
                      "is_active",
                      event.target.value === "active",
                    )
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="active">Aktiv</option>
                </select>
              </label>
              {!isMapped(configProduct) && (
                <p className="muted-copy">
                  Aktivizimi e bën produktin të kërkueshëm në katalog, jo të porositshëm automatikisht. Veprimet kërkojnë workflow dhe autorizim në server.
                </p>
              )}
              <small
                className={`catalog-inline-feedback${rowFeedback[configProduct.id]?.error ? " is-error" : ""}`}
                role={
                  rowFeedback[configProduct.id]?.error ? "alert" : "status"
                }
              >
                {savingRows[configProduct.id] ? (
                  <>
                    <span className="catalog-saving-spinner" aria-hidden="true" />{" "}
                    Po ruhet…
                  </>
                ) : (
                  rowFeedback[configProduct.id]?.error ||
                  rowFeedback[configProduct.id]?.success
                )}
              </small>
            </div>
            <footer className="catalog-dialog-footer">
              <Link
                className="btn btn-ghost"
                href={`/b/${slug}/products/${configProduct.id}`}
              >
                Hap produktin
              </Link>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setConfigId(null)}
              >
                Mbyll
              </button>
            </footer>
          </div>
        )}
      </dialog>

      <dialog
        ref={bulkDialog}
        className="record-create-dialog catalog-dialog"
        aria-labelledby="catalog-bulk-title"
        onClose={() => { setBulkOpen(false); setSelected([]); }}
        onClick={(e) => {
          if (e.target === bulkDialog.current) setBulkOpen(false);
        }}
      >
        <div className="record-create-dialog-body">
          <header className="record-create-dialog-head">
            <div>
              <h2 id="catalog-bulk-title">Veprime</h2>
              <p className="muted-copy">
                {selected.length} produkte në këtë faqe
              </p>
            </div>
            <button
              className="btn btn-ghost"
              type="button"
              aria-label="Mbyll"
              onClick={() => setBulkOpen(false)}
            >
              ×
            </button>
          </header>
          <div className="catalog-dialog-fields">
            <label className="form-label">
              Lloji i produktit
              <select
                className="field"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
              >
                <option value="">Mos e ndrysho</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Proces i posaçëm (opsional)
              <select
                className="field"
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
              >
                <option value="">Mos e ndrysho</option>
                {workflows.filter(w => w.id).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <footer className="catalog-dialog-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                pending ||
                hasSavingRows ||
                !selected.length ||
                (!typeId && !workflowId)
              }
              onClick={() => apply("map")}
            >
              Apliko lloj / workflow
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending || hasSavingRows || !selected.length}
              onClick={() => apply("activate")}
            >
              {mapping ? "Lidh dhe aktivizo" : "Aktivizo"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending || hasSavingRows || !selected.length}
              onClick={() => apply("draft")}
            >
              Kalo në draft
            </button>
            {!mapping && (
              <Link
                className="muted-copy"
                href={`/b/${slug}/products/imports`}
              >
                Importo / lidh katalog →
              </Link>
            )}
            {mapping && (
              <Link className="muted-copy" href={`/b/${slug}/workflows`}>
                Menaxho workflow-t →
              </Link>
            )}
          </footer>
        </div>
      </dialog>
    </div>
  );
}
