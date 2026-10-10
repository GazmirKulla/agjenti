"use client";
import { useCatalogAssistantContext } from "@/components/business-assistant/workspace";
import { useState, useMemo, useTransition, useRef, useEffect } from "react";
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

const STATUS_LABEL: Record<string, string> = {
  active: "Aktiv",
  draft: "Draft",
  unlinked: "I palidhur",
};

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
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  useCatalogAssistantContext({
    searchQuery: query,
    filters: { status: filter },
    selectedEntityIds: selected,
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
    () => catalogFilter(catalogProducts, query, filter, "", "newest"),
    [catalogProducts, query, filter],
  );
  const maxPage = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, maxPage);
  const shown = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const configProduct =
    catalogProducts.find((p) => p.id === configId) ?? null;

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
      if (!result.error && result.product) {
        setRowUpdates((current) => ({
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
            Hap «Konfiguro» te çdo produkt ose zgjidh disa dhe përdor «Veprime»
            për llojin dhe workflow-n.
          </p>
        </div>
      )}
      <section className="panel product-catalog">
        <div className="catalog-toolbar-simple">
          <h2>{mapping ? "Lidh produktet" : "Katalogu"}</h2>
          {selected.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setBulkOpen(true)}
            >
              Veprime ({selected.length})
            </button>
          )}
        </div>
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
            aria-label="Filtro sipas statusit"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Të gjitha</option>
            <option value="active">Aktive</option>
            <option value="draft">Draft</option>
            <option value="unlinked">Të palidhura</option>
            <option value="imports">Katalog i jashtëm</option>
          </select>
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
                return (
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
                    <td>{money(p.price_amount, p.currency)}</td>
                    <td>
                      <span className={`product-status is-${status}`}>
                        {STATUS_LABEL[status] ?? status}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="catalog-row-menu"
                        aria-label={`Konfiguro ${p.name}`}
                        onClick={() => setConfigId(p.id)}
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                );
              })}
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
              <label className="form-label">
                Workflow
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
                  <option value="">Pa workflow</option>
                  {configProduct.workflow_id &&
                    !workflows.some(
                      (workflow) => workflow.id === configProduct.workflow_id,
                    ) && (
                      <option value={configProduct.workflow_id} disabled>
                        Workflow aktual
                      </option>
                    )}
                  {workflows.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))}
                </select>
              </label>
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
                  Produkti është i palidhur — cakto llojin dhe workflow-n para
                  aktivizimit.
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
        onClose={() => setBulkOpen(false)}
        onClick={(e) => {
          if (e.target === bulkDialog.current) setBulkOpen(false);
        }}
      >
        <div className="record-create-dialog-body">
          <header className="record-create-dialog-head">
            <div>
              <h2 id="catalog-bulk-title">Veprime</h2>
              <p className="muted-copy">
                {selected.length} produkte të zgjedhura
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
