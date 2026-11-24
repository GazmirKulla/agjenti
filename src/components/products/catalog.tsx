"use client";
import { attributeSummary, availabilityLabels, fieldsOf, type KindField } from "@/lib/items/kinds";
import { filledFields, missingReadiness, productReadiness } from "@/lib/products/readiness";
import { catalogStockState, stockStateLabels, type StockSettings } from "@/lib/products/stock";
import { attributeFields, type BusinessField } from "@/lib/items/fields";
import { useCatalogAssistantContext } from "@/components/business-assistant/workspace";
import { useState, useMemo, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { Modal } from "@/components/modal/modal";
import { useRouter } from "next/navigation";
import {
  catalogFilter,
  catalogStatus,
  fromWebsite,
  type ProductRow,
  type CatalogField,
  type Option,
} from "@/lib/products/catalog";
import { bulkConfigureProducts } from "@/lib/products/actions";
import { updateCatalogField } from "@/lib/products/inline-actions";
import { productMoney as money } from "@/lib/products/catalog";
import { entityWorkflowHref } from "@/components/workflows/entity-flow-link";

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
  active: "Publik",
  draft: "Jo publik",
  unlinked: "I palidhur",
};
const STATUS_FILTERS = [
  ["all", "Të gjitha"],
  ["active", "Publike"],
  ["archived", "Të arkivuara"],
  ["draft", "Jo publike"],
  ["unlinked", "Të palidhura"],
] as const;
/** Where products come from: the business website's catalog or added here. */
type Source = "all" | "website" | "local";

/** Marks a product that comes from the business website (its data is the website's). */
function WebsiteBadge() {
  return <span className="product-source-web" title="Produkt i lidhur me webin e biznesit">
    <Icon name="globe" size={12} /><span>Webi</span>
  </span>;
}
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
  return p.sku ? `SKU: ${p.sku}` : "";
}

export function ProductCatalog({
  slug,
  products,
  types,
  workflows,
  mapping = false,
  fields = [],
  stock,
}: {
  slug: string;
  products: ProductRow[];
  types: Option[];
  workflows: Option[];
  mapping?: boolean;
  /** The business's own product fields, shown under each name. */
  fields?: BusinessField[];
  /** How the business counts stock: badges and the stock filter follow it. */
  stock?: StockSettings;
}) {
  const extra = attributeFields(fields);
  const [query, setQuery] = useState("");
  const defaultFilter = mapping ? "unlinked" : "all";
  const [filter, setFilter] = useState(defaultFilter);
  const [stockFilter, setStockFilter] = useState<"" | "out" | "low">("");
  const [needsWork, setNeedsWork] = useState(false);
  // What a product still needs for the agent, from the same rule as the product page and form.
  // The list shows only the product's own content: the workflow is the business's, and drafts have their own status.
  const missingOf = (p: ProductRow) => missingReadiness(productReadiness({ ...p, name: p.name, description: p.description, image: p.image_url,
    details: filledFields(fieldsOf(p.item_kind ?? "product", attributeFields(fields)).map(f => f.key), p.attributes),
    workflow: Boolean(p.workflow_id || p.visual_workflow || p.business_workflow?.active),
    active: p.is_active, archived: Boolean(p.archived_at), availability: p.availability })).filter(item => item.key !== "workflow" && item.key !== "active");
  const missingBadge = (p: ProductRow) => {
    const missing = missingOf(p);
    return missing.length ? <span className="product-missing-badge" title={`Për Agjentin mungon: ${missing.map(m => m.label).join(", ")}`}>
      {missing.length === 1 ? `Mungon: ${missing[0].label.replace(/ \(.*\)$/, "")}` : `${missing.length} për plotësim`}</span> : null;
  };
  const stockOf = (p: ProductRow) => stock ? catalogStockState(p, p.variants ?? [], stock) : null;
  const counting = Boolean(stock) && products.some(p => stockOf(p) !== null);
  const stockBadge = (p: ProductRow) => {
    const state = stockOf(p);
    return state && state !== "in_stock" ? <span className={`product-stock-badge is-${state}`}>{stockStateLabels[state]}</span> : null;
  };
  const [typeFilter, setTypeFilter] = useState("");
  const [source, setSource] = useState<Source>("all");
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
    filters: { status: filter === "all" && source === "website" ? "imports" : filter, ...(typeFilter ? { type: typeFilter } : {}) },
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
  const [bulkOpen, setBulkOpen] = useState(false);
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
    () => catalogFilter(catalogProducts, query, filter, typeFilter, sort)
      .filter(p => source === "all" || fromWebsite(p) === (source === "website"))
      .filter(p => !stockFilter || (stockFilter === "out" ? stockOf(p) === "out" : stockOf(p) === "low" || stockOf(p) === "out"))
      .filter(p => !needsWork || missingOf(p).length > 0),
    // stockOf reads the props it closes over; the list recomputes when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogProducts, query, filter, typeFilter, sort, source, stockFilter, stock, needsWork, fields],
  );
  const sourceCounts = useMemo(() => {
    const current = catalogProducts.filter(p => !p.archived_at);
    const website = current.filter(fromWebsite).length;
    return { all: current.length, website, local: current.length - website };
  }, [catalogProducts]);
  const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, maxPage);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const removal = useManualOperation(slug, "product.delete");
  // Multiple delete goes through the same reviewed server operation as the assistant:
  // the server re-resolves each ID, archives products with history, and previews before confirming.
  const bulkRemoval = useManualOperation(slug, "product.remove");
  const removeMany = (ids: string[]) => void bulkRemoval.prepare({ scope: "ids", ids });
  const activeFilters = Number(filter !== defaultFilter) + Number(Boolean(typeFilter)) + Number(Boolean(stockFilter)) + Number(needsWork);
  const filterItems: RowMenuItem[] = [
    ...STATUS_FILTERS.map(([value, label]) => ({
      group: "Statusi", label, checked: filter === value,
      onSelect: () => { setFilter(value); setPage(1); },
    })),
    ...(types.length
      ? [{ id: "", name: "Të gjitha shabllonet" }, ...types].map((type) => ({
          group: "Shablloni i porosisë", label: type.name, checked: typeFilter === type.id,
          onSelect: () => { setTypeFilter(type.id); setPage(1); },
        }))
      : []),
    ...(counting
      ? ([["", "E gjithë gjendja"], ["low", "Pak copë ose mbaruar"], ["out", "Ka mbaruar"]] as const).map(([value, label]) => ({
          group: "Gjendja", label, checked: stockFilter === value,
          onSelect: () => { setStockFilter(value); setPage(1); },
        }))
      : []),
    { group: "Gatishmëria", label: "Ka nevojë për plotësim", checked: needsWork, onSelect: () => { setNeedsWork(value => !value); setPage(1); } },
    ...(activeFilters
      ? [{ label: "Pastro filtrat", onSelect: () => { setFilter(defaultFilter); setTypeFilter(""); setStockFilter(""); setNeedsWork(false); setPage(1); } }]
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
    { group: "Cilësimet", label: "Struktura", hint: "Llojet, fushat dhe stoku i produkteve", href: `/b/${slug}/products/structure` },
    {
      group: "Veprime",
      label: `Konfiguro produktet e kësaj faqeje (${shown.length})`,
      disabled: !shown.length,
      onSelect: () => { setSelected(shown.map((p) => p.id)); setBulkOpen(true); },
    },
    // Deleting is never a menu item: it starts from a selection, in the bar that shows what is selected.
    {
      group: "Veprime",
      label: `Zgjidh produktet e kësaj faqeje (${shown.length})`,
      disabled: !shown.length,
      onSelect: () => setSelected(shown.map((p) => p.id)),
    },
  ];
  function rowActions(p: ProductRow): RowMenuItem[] {
    return [
      { label: "Hap produktin", href: `/b/${slug}/products/${p.id}` },
      // The product's one status, as the editor's Publik switch.
      p.is_active
        ? { label: "Bëje jo publik", disabled: pending || Boolean(savingRows[p.id]), onSelect: () => void editRow(p, "is_active", false) }
        : { label: "Publikoje", disabled: pending || Boolean(savingRows[p.id]) || Boolean(p.archived_at), onSelect: () => void editRow(p, "is_active", true) },
      ...(p.visual_workflow
        ? [{ label: `Hap procesin: ${p.visual_workflow.name}`, href: entityWorkflowHref(slug, "product", p.id, p.visual_workflow.flowId) }]
        : []),
      { label: "Fshi produktin", danger: true, disabled: removal.busy, onSelect: () => void removal.prepare({ id: p.id }) },
    ];
  }

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
    try {
      const result = await updateCatalogField(slug, {
        id: product.id,
        field,
        value,
        updatedAt: product.updated_at ?? "",
      });
      // The outcome, success or refusal (e.g. no price to publish), shows in the list's notice.
      if (result.error) setNotice(`${product.name}: ${result.error}`);
      else {
        if (!result.product) setRowUpdates(current => { const next = { ...current }; delete next[product.id]; return next; });
        if (result.product) setRowUpdates((current) => ({
          ...current,
          [product.id]: result.product!,
        }));
        setNotice(`${product.name}: ${result.success ?? "U ruajt."}`);
        router.refresh();
      }
    } catch {
      setNotice(`${product.name}: Ndryshimi nuk u ruajt. Provo përsëri.`);
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
        {/* Only when products come from both places: with one source the split repeats "Të gjitha". */}
        {!mapping && sourceCounts.website > 0 && sourceCounts.local > 0 && (
          <div className="catalog-source" role="group" aria-label="Burimi i produkteve">
            {([
              ["all", "Të gjitha", sourceCounts.all],
              ["website", "Nga webi", sourceCounts.website],
              ["local", "Të shtuara këtu", sourceCounts.local],
            ] as const).map(([value, label, count]) => (
              <button key={value} type="button" className={source === value ? "is-active" : ""} aria-pressed={source === value}
                onClick={() => { setSource(value); setPage(1); }}>
                {value === "website" && <Icon name="globe" size={14} />}
                {label}<span className="catalog-source-count">{count}</span>
              </button>
            ))}
          </div>
        )}
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
            {filtered.length > selected.length && filtered.length <= 100 && (
              <button type="button" className="btn btn-ghost" onClick={() => setSelected(filtered.map((p) => p.id))}>Zgjidh të gjitha sipas filtrit ({filtered.length})</button>
            )}
            <button type="button" className="btn btn-ghost" disabled={pending || hasSavingRows} onClick={() => apply("activate")}>{mapping ? "Lidh dhe bëji publike" : "Bëji publike"}</button>
            <button type="button" className="btn btn-ghost" disabled={pending || hasSavingRows} onClick={() => apply("draft")}>Bëji jo publike</button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setBulkOpen(true)}>Shablloni / procesi</button>
            <button type="button" className="btn btn-ghost catalog-bulk-danger" disabled={bulkRemoval.busy} onClick={() => removeMany(selected)}>Fshi</button>
            <button type="button" className="catalog-bulk-clear" onClick={() => setSelected([])}>Pastro</button>
          </div>
        )}
        {/* The count only when a search or filter narrows the list; otherwise the tabs or the list say it. */}
        {shown.length > 0 && filtered.length !== sourceCounts[source] && <p className="catalog-count">{filtered.length} produkte</p>}
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
                        <strong>{p.name}{fromWebsite(p) && <WebsiteBadge />}</strong>
                        <small>{itemSubline(p, extra)}</small>
                        <span className="product-card-meta">
                          <span>{money(p.price_amount, p.currency, { mode: p.price_mode, max: p.price_max, unit: p.price_unit })}</span>
                          <span className={`product-status is-${status}`}>{STATUS_LABEL[status] ?? status}</span>
                          {p.availability && p.availability !== "available" && <span className={`product-availability is-${p.availability}`}>{availabilityLabels[p.availability]}</span>}{stockBadge(p)}{missingBadge(p)}
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
                    <strong>{p.name}{fromWebsite(p) && <WebsiteBadge />}</strong>
                    <small>{itemSubline(p, extra)}</small>
                    <span className="product-card-meta">
                      <span>{money(p.price_amount, p.currency, { mode: p.price_mode, max: p.price_max, unit: p.price_unit })}</span>
                      <span className={`product-status is-${status}`}>{STATUS_LABEL[status] ?? status}</span>
                      {p.availability && p.availability !== "available" && <span className={`product-availability is-${p.availability}`}>{availabilityLabels[p.availability]}</span>}{stockBadge(p)}{missingBadge(p)}
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
                          <strong>{p.name}{fromWebsite(p) && <WebsiteBadge />}</strong>
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
                      {p.availability && p.availability !== "available" && <span className={`product-availability is-${p.availability}`}>{availabilityLabels[p.availability]}</span>}{stockBadge(p)}{missingBadge(p)}
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
                ? source !== "all" ? "Ndrysho kërkimin, filtrin ose burimin." : "Ndrysho kërkimin ose filtrin."
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

      <Modal
        size="md"
        open={bulkOpen}
        onClose={() => { setBulkOpen(false); setSelected([]); }}
        title="Veprime"
        subtitle={`${selected.length} produkte në këtë faqe`}
        footer={
          <div className="catalog-dialog-actions">
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
              {mapping ? "Lidh dhe bëji publike" : "Bëji publike"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={pending || hasSavingRows || !selected.length}
              onClick={() => apply("draft")}
            >
              Bëji jo publike
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
          </div>
        }
      >
        <div className="catalog-dialog-fields">
          <label className="form-label">
            Shablloni i porosisë
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
      </Modal>
    </div>
  );
}
