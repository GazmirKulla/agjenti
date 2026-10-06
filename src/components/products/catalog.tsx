"use client";
import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  catalogFilter,
  catalogStatus,
  isMapped,
  statusNames,
  type ProductRow,
  type Option,
} from "@/lib/products/catalog";
import { bulkConfigureProducts } from "@/lib/products/actions";
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
  const router = useRouter();
  const filtered = useMemo(
    () => catalogFilter(products, query, filter, type, sort),
    [products, query, filter, type, sort],
  );
  const maxPage = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, maxPage);
  const shown = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const count = (s: string) =>
    products.filter(
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
              disabled={pending || !selected.length}
              onClick={() => apply("draft")}
            >
              Kalo në draft
            </button>
            {!mapping && (
              <button
                className="btn btn-ghost"
                disabled={pending || !selected.length}
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
                      {types.find((t) => t.id === p.product_type_id)?.name ??
                        "Pa lloj"}
                    </td>
                    <td>{money(p.price_amount, p.currency)}</td>
                    <td>
                      <span className="product-tag">
                        {workflows.find((w) => w.id === p.workflow_id)?.name ??
                          "Pa workflow"}
                      </span>
                    </td>
                    <td>
                      <span className={`product-status is-${catalogStatus(p)}`}>
                        {statusNames[catalogStatus(p)]}
                      </span>
                      {!isMapped(p) && !p.is_active && (
                        <small className="product-draft-note">Draft</small>
                      )}
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
              disabled={pending || !selected.length || (!typeId && !workflowId)}
              onClick={() => apply("map")}
            >
              Apliko për të zgjedhurat
            </button>
            <button
              className="btn btn-ghost"
              disabled={pending || !selected.length}
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
