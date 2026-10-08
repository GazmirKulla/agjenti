"use client";
import { useState, useMemo, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  catalogFilter,
  catalogStatus,
  isMapped,
  type ProductRow,
  type Option,
} from "@/lib/products/catalog";
import { bulkConfigureProducts } from "@/lib/products/actions";
import { updateCatalogField, type CatalogField } from "@/lib/products/inline-actions";
import { productMoney as money } from "@/lib/products/catalog";
import { ProductMethods, ProductTips } from "./shared";
export function ProductCatalog({
  slug,
  products,
  types,
  workflows,
  mapping = false,
}: {
  slug: string;
  products: ProductRow[];
  types: Option[];
  workflows: Option[];
  mapping?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(mapping ? "unlinked" : "all");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState("");
  const [typeId, setTypeId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [rowUpdates, setRowUpdates] = useState<Record<string, ProductRow>>({});
  const [savingRows, setSavingRows] = useState<Record<string, { field: CatalogField; value: string | boolean | null }>>({});
  const [rowFeedback, setRowFeedback] = useState<Record<string, { error?: string; success?: string }>>({});
  const inFlight = useRef(new Set<string>());
  const hasSavingRows = Object.keys(savingRows).length > 0;
  const catalogProducts = useMemo(() => products.map(product => {
    const edited = rowUpdates[product.id];
    return edited && Date.parse(edited.updated_at ?? "") > Date.parse(product.updated_at ?? "") ? edited : product;
  }), [products, rowUpdates]);
  const router = useRouter();
  const filtered = useMemo(
    () => catalogFilter(catalogProducts, query, filter, type, sort),
    [catalogProducts, query, filter, type, sort],
  );
  const maxPage = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, maxPage);
  const shown = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const count = (s: string) =>
    catalogProducts.filter(
      (p) =>
        s === "all" ||
        (s === "imports"
          ? p.source === "linked" || !!p.external_id
          : catalogStatus(p) === s),
    ).length;
  function changeFilter(next: string) {
    setFilter(next);
    setPage(1);
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
          router.refresh();
        }
      } catch {
        setNotice("Ndryshimet nuk u ruajtën. Provo përsëri.");
      }
    });
  }
  async function editRow(product: ProductRow, field: CatalogField, value: string | boolean | null) {
    if (pending || inFlight.current.has(product.id) || product[field] === value) return;
    inFlight.current.add(product.id);
    setSavingRows(current => ({ ...current, [product.id]: { field, value } }));
    setRowFeedback(current => ({ ...current, [product.id]: {} }));
    try {
      const result = await updateCatalogField(slug, { id: product.id, field, value, updatedAt: product.updated_at ?? "" });
      setRowFeedback(current => ({ ...current, [product.id]: { error: result.error, success: result.success } }));
      if (!result.error && result.product) {
        setRowUpdates(current => ({ ...current, [product.id]: result.product! }));
        setNotice(`${product.name}: ${result.success ?? "U ruajt."}`);
        router.refresh();
      }
    } catch {
      setRowFeedback(current => ({ ...current, [product.id]: { error: "Ndryshimi nuk u ruajt. Provo përsëri." } }));
    } finally {
      inFlight.current.delete(product.id);
      setSavingRows(current => { const next = { ...current }; delete next[product.id]; return next; });
    }
  }
  return (
    <div className="products-workspace">
      <main>
        <div className="product-stats">
          {[
            ["all", "Total produkte", "□"],
            ["draft", "Draft", "▤"],
            ["active", "Aktive", "●"],
            ["unlinked", "Të palidhura", "↗"],
          ].map(([key, label, icon]) => (
            <button
              key={key}
              className="panel"
              onClick={() => changeFilter(key)}
            >
              <span className="icon-tile" aria-hidden>
                {icon}
              </span>
              <span>
                {label}
                <strong>{count(key)}</strong>
              </span>
            </button>
          ))}
        </div>
        {mapping && (
          <div className="catalog-notice">
            <strong>{count("unlinked")} produkte të palidhura</strong>
            <p>
              Zgjidh llojin dhe workflow-n përpara aktivizimit. Produktet e
              importuara me AI mbeten joaktive derisa t’i kontrollosh.
            </p>
          </div>
        )}
        <section className="panel product-catalog">
          <h2>{mapping ? "Lidh produktet" : "Katalogu"}</h2>
          <div className="catalog-search">
            <input
              className="field"
              aria-label="Kërko produkte"
              placeholder="Kërko emër, SKU ose përshkrim…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
            <select
              className="field"
              aria-label="Filtro sipas llojit"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Të gjitha llojet</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="catalog-toolbar">
            <div className="catalog-tabs" role="group" aria-label="Statusi">
              {[
                ["all", "Të gjitha"],
                ["active", "Aktive"],
                ["draft", "Draft"],
                ["unlinked", "Të palidhura"],
                ["imports", "Katalog i jashtëm"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => changeFilter(key)}
                >
                  {label}
                  <span>{count(key)}</span>
                </button>
              ))}
            </div>
            <select
              className="field"
              aria-label="Rendit produktet"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Më të rejat</option>
              <option value="name">Emri A–Z</option>
              <option value="price">Çmimi në rritje</option>
            </select>
          </div>
          <div className="catalog-bulk">
            <span>{selected.length} të zgjedhura</span>
            {!mapping && (
              <Link href={`/b/${slug}/products/imports`}>
                Lidh llojin dhe workflow-n →
              </Link>
            )}
            <button
              className="btn btn-ghost"
              disabled={pending || hasSavingRows || !selected.length}
              onClick={() => apply("draft")}
            >
              Kalo në draft
            </button>
            {!mapping && (
              <button
                className="btn btn-ghost"
                disabled={pending || hasSavingRows || !selected.length}
                onClick={() => apply("activate")}
              >
                Aktivizo
              </button>
            )}
          </div>
          {notice && (
            <p role="status" className="catalog-notice">
              {notice}
            </p>
          )}
          <div className="product-table-scroll">
            <table className="product-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Zgjidh produktet e kësaj faqeje"
                      checked={
                        shown.length > 0 &&
                        shown.every((p) => selected.includes(p.id))
                      }
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...new Set([...ids, ...shown.map((p) => p.id)])]
                            : ids.filter(
                                (id) => !shown.some((p) => p.id === id),
                              ),
                        )
                      }
                    />
                  </th>
                  <th>Produkti</th>
                  <th>Lloji</th>
                  <th>Çmimi</th>
                  <th>Workflow</th>
                  <th>Statusi</th>
                  <th>
                    <span className="sr-only">Veprime</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr
                    key={p.id}
                    className={selected.includes(p.id) ? "is-selected" : ""}
                    aria-busy={Boolean(savingRows[p.id])}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Zgjidh ${p.name}`}
                        checked={selected.includes(p.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, p.id]
                              : ids.filter((id) => id !== p.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <Link
                        className="product-cell"
                        href={`/b/${slug}/products/${p.id}`}
                      >
                        {p.image_url ? (
                          <img src={p.image_url} alt="" loading="lazy" />
                        ) : (
                          <span className="product-no-image" aria-hidden>
                            □
                          </span>
                        )}
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.sku
                              ? `SKU: ${p.sku}`
                              : p.source === "linked"
                                ? "Katalog i lidhur"
                                : "Pa SKU"}
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <select className="catalog-inline-select catalog-type-select" aria-label={`Lloji i ${p.name}`} aria-describedby={`catalog-feedback-${p.id}`} value={savingRows[p.id]?.field === "product_type_id" ? String(savingRows[p.id].value ?? "") : p.product_type_id ?? ""} disabled={pending || Boolean(savingRows[p.id])} onChange={event => void editRow(p, "product_type_id", event.target.value || null)}>
                        <option value="">Pa lloj</option>
                        {p.product_type_id && !types.some(type => type.id === p.product_type_id) && <option value={p.product_type_id} disabled>Lloji aktual (joaktiv)</option>}
                        {types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
                      </select>
                    </td>
                    <td>{money(p.price_amount, p.currency)}</td>
                    <td>
                      <select className="catalog-inline-select catalog-workflow-select" aria-label={`Workflow i ${p.name}`} aria-describedby={`catalog-feedback-${p.id}`} value={savingRows[p.id]?.field === "workflow_id" ? String(savingRows[p.id].value ?? "") : p.workflow_id ?? ""} disabled={pending || Boolean(savingRows[p.id])} onChange={event => void editRow(p, "workflow_id", event.target.value || null)}>
                        <option value="">Pa workflow</option>
                        {p.workflow_id && !workflows.some(workflow => workflow.id === p.workflow_id) && <option value={p.workflow_id} disabled>Workflow aktual</option>}
                        {workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <div className={`catalog-status-picker is-${catalogStatus(p)}`}>
                        <select className="catalog-inline-select" aria-label={`Statusi i ${p.name}`} aria-describedby={`catalog-feedback-${p.id}`} value={(savingRows[p.id]?.field === "is_active" ? savingRows[p.id].value : p.is_active) ? "active" : "draft"} disabled={pending || Boolean(savingRows[p.id])} onChange={event => void editRow(p, "is_active", event.target.value === "active")}>
                          <option value="draft">Draft</option><option value="active">Aktiv</option>
                        </select>
                      </div>
                      {!isMapped(p) && <small className="product-draft-note">I palidhur</small>}
                      <small id={`catalog-feedback-${p.id}`} className={`catalog-inline-feedback${rowFeedback[p.id]?.error ? " is-error" : ""}`} role={rowFeedback[p.id]?.error ? "alert" : "status"}>
                        {savingRows[p.id] ? <><span className="catalog-saving-spinner" aria-hidden="true" /> Po ruhet…</> : rowFeedback[p.id]?.error || rowFeedback[p.id]?.success}
                      </small>
                    </td>
                    <td>
                      <Link
                        className="btn btn-ghost"
                        aria-label={`Hap ${p.name}`}
                        href={`/b/${slug}/products/${p.id}`}
                      >
                        ›
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!shown.length && (
            <div className="empty-state">
              <h3>
                {products.length
                  ? "Nuk u gjetën produkte"
                  : "Ende nuk ka produkte"}
              </h3>
              <p>
                {products.length
                  ? "Ndrysho kërkimin ose filtrat."
                  : "Shto produktin e parë nga paneli i shtimit."}
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
                ? `${(currentPage - 1) * 10 + 1}–${Math.min(currentPage * 10, filtered.length)}`
                : "0"}{" "}
              nga {filtered.length} produkte
            </span>
            <div>
              <button
                className="btn btn-ghost"
                aria-label="Faqja e mëparshme"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                ‹
              </button>
              <span>
                {currentPage} / {maxPage}
              </span>
              <button
                className="btn btn-ghost"
                aria-label="Faqja pasuese"
                disabled={currentPage >= maxPage}
                onClick={() => setPage(currentPage + 1)}
              >
                ›
              </button>
            </div>
          </footer>
        </section>
      </main>
      <aside className="product-side">
        {mapping ? (
          <section className="panel section-pad">
            <h2>Mapim dhe veprime</h2>
            <p className="muted-copy">
              {selected.length} produkte të zgjedhura. Një fushë bosh ruan
              vlerën ekzistuese.
            </p>
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
              Workflow i biznesit
              <select
                className="field"
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
              >
                <option value="">Mos e ndrysho</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-primary"
              disabled={pending || hasSavingRows || !selected.length || (!typeId && !workflowId)}
              onClick={() => apply("map")}
            >
              Apliko për të zgjedhurat
            </button>
            <button
              className="btn btn-ghost"
              disabled={pending || hasSavingRows || !selected.length}
              onClick={() => apply("activate")}
            >
              Lidh dhe aktivizo
            </button>
            <Link href={`/b/${slug}/workflows`}>Menaxho workflow-t →</Link>
          </section>
        ) : (
          <section className="panel section-pad">
            <h2>Shto produkt të ri</h2>
            <p className="muted-copy">
              Zgjidh si dëshiron ta shtosh produktin në katalog.
            </p>
            <ProductMethods slug={slug} compact />
          </section>
        )}
        <ProductTips />
      </aside>
    </div>
  );
}
