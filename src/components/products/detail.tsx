"use client";
import Link from "next/link";
import { useState } from "react";
import { attributeDetails, availabilityLabels, fieldsOf } from "@/lib/items/kinds";
import { attributeFields, variantFields, type BusinessField } from "@/lib/items/fields";
import { catalogStatus, productMoney, type Option, type ProductRow } from "@/lib/products/catalog";
import { priceMode, priceModeLabels, priceReady } from "@/lib/products/pricing";
import { usePageAssistantContext } from "@/components/business-assistant/workspace";
import { useManualOperation } from "@/components/dashboard/operation-button";
import { RowMenu, type RowMenuItem } from "@/components/dashboard/row-menu";
import { Icon } from "@/components/dashboard/icon";
import { ProductBusinessWorkflow } from "./business-workflow";

const STATUS_LABEL: Record<string, string> = { archived: "I arkivuar", active: "Aktiv", draft: "Draft", unlinked: "I palidhur" };
type Tab = "overview" | "variants" | "media" | "workflow";

const MONTHS = ["jan", "shk", "mar", "pri", "maj", "qer", "korr", "gush", "sht", "tet", "nën", "dhj"];
/** "14 nën 2026" in Tirana time, the same on the server and in the browser (no locale data). */
function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Tirane" })
    .formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
}

/** The product page in view mode, in the layout of the new design: a header with name, status and
 * a menu; tabs; a summary card with three tiles; the key data as label–value rows. "Përditëso"
 * opens the existing form (`?edit=1`), so every field keeps working as before. */
export function ProductDetail({ slug, product, types, workflows, kind, fields = [] }: {
  slug: string;
  product: ProductRow;
  types: Option[];
  workflows: Option[];
  kind?: string;
  fields?: BusinessField[];
}) {
  usePageAssistantContext({ entityType: "product", entityId: product.id, selectionLabel: product.name });
  const [tab, setTab] = useState<Tab>("overview");
  const base = `/b/${slug}/products/${product.id}`;
  const edit = (anchor = "") => `${base}?edit=1${anchor}`;
  const status = catalogStatus(product);
  const kindId = product.item_kind ?? kind ?? "product";
  const extra = attributeFields(fields);
  const choices = variantFields(fields);
  const variants = product.variants ?? [];
  const activeVariants = variants.filter(v => v.is_active).length;
  const type = types.find(t => t.id === product.product_type_id);
  const special = workflows.find(w => w.id && w.id === product.workflow_id);
  const businessWorkflow = workflows.find(w => w.businessWorkflow)?.businessWorkflow;
  const price = productMoney(product.price_amount, product.currency, { mode: product.price_mode, max: product.price_max, unit: product.price_unit });
  const inCatalog = product.is_active && !product.archived_at;
  const values = product.attributes ?? {};
  const details = fieldsOf(kindId, extra).flatMap(f => {
    const text = attributeDetails(kindId, { [f.key]: values[f.key] }, extra);
    return text ? [[f.label, text.slice(f.label.length + 2)] as const] : [];
  });
  const lists = choices.flatMap(f => {
    const list = values[f.key];
    return Array.isArray(list) && list.length ? [[f.label, `${list.join(", ")}${f.unit ? ` ${f.unit}` : ""}`] as const] : [];
  });
  const label = (options: Record<string, string>) =>
    Object.entries(options).map(([key, value]) => `${choices.find(f => f.key === key)?.label ?? key}: ${value}`).join(" · ");
  const ready = [
    ["Çmimi ose “Sipas kërkesës”", priceReady(product)],
    ["Lloji i produktit", Boolean(product.product_type_id)],
    ["Workflow për porosinë", Boolean(product.workflow_id || product.visual_workflow || businessWorkflow?.active)],
    ["Foto e produktit", Boolean(product.image_url)],
    ["Aktiv në katalog", inCatalog],
  ] as const;

  const archive = useManualOperation(slug, product.archived_at ? "product.restore" : "product.archive");
  const removal = useManualOperation(slug, "product.delete", `/b/${slug}/products`);
  const menu: RowMenuItem[] = [
    { label: "Përditëso produktin", href: edit() },
    { label: product.archived_at ? "Rikthe si draft" : "Arkivo produktin", disabled: archive.busy, onSelect: () => void archive.prepare({ id: product.id }) },
    { label: "Fshi produktin", danger: true, disabled: removal.busy, onSelect: () => void removal.prepare({ id: product.id }) },
  ];
  const tabs: [Tab, string][] = [
    ["overview", "Përmbledhje"],
    ...(choices.length || variants.length ? [["variants", variants.length ? `Variante (${variants.length})` : "Variante"] as [Tab, string]] : []),
    ["media", "Media"],
    ["workflow", "Workflow"],
  ];

  return (
    <div className="product-detail">
      <header className="product-detail-head">
        <Link className="muted-copy" href={`/b/${slug}/products`}>‹ Produktet</Link>
        <div className="product-detail-title">
          <h1>{product.name}</h1>
          <span className={`product-status is-${status}`}>{STATUS_LABEL[status] ?? status}</span>
          <span className="product-detail-menu"><RowMenu label={`Më shumë për ${product.name}`} title={product.name} items={menu} /></span>
        </div>
        <p>Detajet e produktit, çmimi, variantet dhe si e merr agjenti porosinë.</p>
      </header>

      <div className="product-detail-tabs" role="tablist" aria-label="Seksionet e produktit">
        {tabs.map(([id, text]) => (
          <button key={id} type="button" role="tab" id={`product-tab-${id}`} aria-selected={tab === id} aria-controls={`product-panel-${id}`}
            className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{text}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="product-detail-panel" role="tabpanel" id="product-panel-overview" aria-labelledby="product-tab-overview">
          <section className="panel product-detail-summary">
            <div className="product-detail-photo">
              {product.image_url ? <img src={product.image_url} alt={product.name} /> : <Icon name="products" size={40} />}
            </div>
            <div className="product-detail-info">
              <h2>{product.name}</h2>
              <strong className="product-detail-price">{price}</strong>
              <div className="product-detail-chips">
                {type && <span className="product-chip">{type.name}</span>}
                {product.sku && <span className="product-chip">Kodi: {product.sku}</span>}
                {product.availability && product.availability !== "available" && <span className={`product-availability is-${product.availability}`}>{availabilityLabels[product.availability]}</span>}
              </div>
              <p>{product.description || "Ende pa përshkrim."}</p>
            </div>
            <dl className="product-detail-tiles">
              <div><dt>Statusi</dt><dd>{STATUS_LABEL[status] ?? status}</dd></div>
              <div><dt>Variantet</dt><dd>{variants.length ? (activeVariants === variants.length ? variants.length : `${activeVariants} nga ${variants.length}`) : "—"}</dd></div>
              <div><dt>Në katalog</dt><dd>{inCatalog ? "Po" : "Jo"}</dd></div>
            </dl>
          </section>

          <div className="product-detail-columns">
            <section className="panel product-detail-card">
              <div className="product-detail-card-head">
                <h2>Të dhënat kryesore</h2>
                <Link className="btn btn-ghost" href={edit()}><Icon name="edit" size={15} /> Përditëso</Link>
              </div>
              <dl className="product-detail-rows">
                <div><dt>Lloji</dt><dd>{type?.name ?? "Pa lloj"}</dd></div>
                <div><dt>Kodi</dt><dd>{product.sku || "—"}</dd></div>
                <div><dt>Çmimi</dt><dd>{price}<small>{priceModeLabels[priceMode(product.price_mode)]}</small></dd></div>
                {details.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}
                <div><dt>Krijuar më</dt><dd>{formatDate(product.created_at)}</dd></div>
                <div><dt>Përditësuar më</dt><dd>{formatDate(product.updated_at)}</dd></div>
              </dl>
            </section>
            <section className="panel product-detail-card">
              <div className="product-detail-card-head">
                <h2>Gati për klientët</h2>
                <span className="muted-copy">{ready.filter(([, ok]) => ok).length} nga {ready.length}</span>
              </div>
              <ul className="product-checklist">
                {ready.map(([text, ok]) => (
                  <li key={text} className={ok ? "is-complete" : ""}><span aria-hidden>{ok ? "✓" : "○"}</span>{text}{text === "Foto e produktit" ? " (opsionale)" : ""}</li>
                ))}
              </ul>
              <p className="muted-copy product-detail-note">Aktiv në katalog do të thotë që agjenti e gjen dhe e rekomandon. Porosia kërkon workflow dhe autorizim në server.</p>
            </section>
          </div>
        </div>
      )}

      {tab === "variants" && (
        <div className="product-detail-panel" role="tabpanel" id="product-panel-variants" aria-labelledby="product-tab-variants">
          <section className="panel product-detail-card">
            <div className="product-detail-card-head">
              <h2>Variantet dhe çmimet</h2>
              <Link className="btn btn-ghost" href={edit("#product-variants")}><Icon name="edit" size={15} /> Ndrysho</Link>
            </div>
            {lists.length > 0 && (
              <dl className="product-detail-rows">
                {lists.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}
              </dl>
            )}
            {variants.length > 0 ? (
              <div className="product-table-scroll product-detail-variants">
                <table className="product-table">
                  <thead><tr><th>Varianti</th><th>Kodi</th><th>Çmimi</th><th>Në shitje</th></tr></thead>
                  <tbody>
                    {variants.map((v, i) => (
                      <tr key={v.id ?? i}>
                        <td>{label(v.options)}</td>
                        <td>{v.sku || "—"}</td>
                        <td className="product-table-price">{v.price_amount === null ? <span className="muted-copy">si produkti</span> : productMoney(v.price_amount, product.currency)}</td>
                        <td>{v.is_active ? "Po" : "Jo"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : !lists.length && <p className="muted-copy">Ky produkt nuk ka ende variante. Shtoji te “Ndrysho”, ose shto fusha “Zgjedh klienti” te Cilësimet.</p>}
          </section>
        </div>
      )}

      {tab === "media" && (
        <div className="product-detail-panel" role="tabpanel" id="product-panel-media" aria-labelledby="product-tab-media">
          <section className="panel product-detail-card">
            <div className="product-detail-card-head">
              <h2>Foto</h2>
              <Link className="btn btn-ghost" href={edit("#product-media")}><Icon name="edit" size={15} /> {product.image_url ? "Ndrysho foton" : "Shto foto"}</Link>
            </div>
            <div className="product-detail-media">
              {product.image_url ? <img src={product.image_url} alt={product.name} /> : <span><Icon name="image" size={36} /><small>Ende pa foto</small></span>}
            </div>
          </section>
        </div>
      )}

      {tab === "workflow" && (
        <div className="product-detail-panel" role="tabpanel" id="product-panel-workflow" aria-labelledby="product-tab-workflow">
          <section className="panel product-detail-card">
            <div className="product-detail-card-head">
              <h2>Si e merr agjenti porosinë</h2>
              <Link className="btn btn-ghost" href={edit("#product-process")}><Icon name="edit" size={15} /> Ndrysho</Link>
            </div>
            <dl className="product-detail-rows">
              <div><dt>Lloji i produktit</dt><dd>{type?.name ?? "Pa lloj"}{type?.description && <small>{type.description}</small>}</dd></div>
              <div><dt>Proces i posaçëm</dt><dd>{product.visual_workflow?.name ?? special?.name ?? "Jo, përdoret workflow-i kryesor"}</dd></div>
            </dl>
            <ProductBusinessWorkflow slug={slug} workflow={businessWorkflow} product={product} />
          </section>
        </div>
      )}
      {archive.dialog}
      {removal.dialog}
    </div>
  );
}
