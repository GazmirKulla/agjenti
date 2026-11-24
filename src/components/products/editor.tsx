"use client";
import { OperationButton } from "@/components/dashboard/operation-button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProductFields, PublishSwitch } from "@/components/dashboard/product-fields";
import { ReadinessList } from "./readiness-list";
import { filledFields, productReadiness } from "@/lib/products/readiness";
import { fieldsOf } from "@/lib/items/kinds";
import { attributeFields } from "@/lib/items/fields";
import {
  createProduct,
  updateProduct,
} from "@/lib/products/actions";
import { ProductPhoto } from "./product-photo";
import type { ProductRow, Option } from "@/lib/products/catalog";
import { usePageAssistantContext } from "@/components/business-assistant/workspace";
export function ProductEditor({
  slug,
  product,
  workflows,
  kind,
  fields = [],
  usage,
  draft,
  stock,
}: {
  slug: string;
  product?: ProductRow;
  workflows: Option[];
  /** The item kind (product, property…); adds its own fields to the form. */
  kind?: string;
  fields?: import("@/lib/items/fields").BusinessField[];
  usage?: import("@/lib/items/field-visibility").FieldUsage;
  /** A new product prefilled from another source (e.g. a website page); saved as a new product. */
  draft?: Partial<ProductRow>;
  /** How the business counts stock; the form's stock section follows it. */
  stock?: import("@/lib/products/stock").StockSettings;
}) {
  const initial = product ?? draft;
  usePageAssistantContext(product ? { entityType: "product", entityId: product.id, selectionLabel: product.name } : {});
  const businessWorkflow = workflows.find(w => w.businessWorkflow)?.businessWorkflow;
  // The product's own fields (the kind's and the business's), as the form names them: attr_<key>.
  const detailKeys = fieldsOf(kind ?? "product", attributeFields(fields)).map(f => f.key);
  const [preview, setPreview] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    image: initial?.image_url ?? "",
    price: initial?.price_amount ?? (null as number | null),
    mode: (initial?.price_mode ?? "fixed") as string,
    max: initial?.price_max ?? (null as number | null),
    unit: initial?.price_unit ?? "",
    currency: initial?.currency ?? "ALL",
    workflow: initial?.workflow_id ?? "",
    active: initial?.is_active ?? false,
    details: filledFields(detailKeys, initial?.attributes),
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const readiness = productReadiness({ name: preview.name, description: preview.description, image: preview.image,
    price_amount: preview.price, price_mode: preview.mode, price_max: preview.max, currency: preview.currency, details: preview.details,
    workflow: !!preview.workflow || !!product?.visual_workflow || !!businessWorkflow?.active,
    active: preview.active, archived: Boolean(product?.archived_at), availability: product?.availability });
  return (
    <>
      <form
        className="product-editor products-workspace"
        onInput={(e) => {
          const form = e.currentTarget;
          const d = new FormData(form);
          const price = String(d.get("price") ?? ""), max = String(d.get("price_max") ?? "");
          setPreview(() => ({
            name: String(d.get("name") ?? ""),
            description: String(d.get("description") ?? ""),
            image: String(d.get("image_url") ?? ""),
            price: price === "" ? null : Number(price),
            mode: String(d.get("price_mode") ?? "fixed"),
            max: max === "" ? null : Number(max),
            unit: String(d.get("price_unit") ?? ""),
            currency: String(d.get("currency") ?? "ALL"),
            workflow: String(d.get("workflow_id") ?? ""),
            active: d.get("is_active") === "on",
            details: filledFields(detailKeys, Object.fromEntries(detailKeys.map(key => [key, d.get(`attr_${key}`) ?? undefined]))),
          }));
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const data = new FormData(
            e.currentTarget,
            (e.nativeEvent as SubmitEvent).submitter,
          );
          setError("");
          setSuccess("");
          start(async () => {
            try {
              const result = await (product
                ? updateProduct(slug, data)
                : createProduct(slug, data));
              if (result.error) setError(result.error);
              else {
                setSuccess(result.success ?? "U ruajt.");
                if (!product) router.push(`/b/${slug}/products`);
                router.refresh();
              }
            } catch {
              setError("Ruajtja dështoi. Provo përsëri.");
            }
          });
        }}
      >
        <fieldset className="product-editor-fields" disabled={pending}>
          {product && (
            <><input type="hidden" name="product_id" value={product.id} /><input type="hidden" name="updated_at" value={product.updated_at ?? ""} /></>
          )}
          {product && (
            <section className="panel product-summary">
              {product.image_url && (
                <img src={product.image_url} alt={product.name} />
              )}
              <div>
                <h2>{product.name}</h2>
                {product.sku && <p className="muted-copy">SKU: {product.sku}</p>}
                <p>{product.description || "Shto përshkrimin e produktit."}</p>
              </div>
            </section>
          )}
          <div className="panel product-editor-card">
            <nav
              className="product-editor-nav"
              aria-label="Seksionet e produktit"
            >
              <a href="#product-identity">Përmbledhje</a>
              <a href="#product-details">Të dhënat</a>
              <a href="#product-pricing">Çmimi</a>
              <a href="#product-stock">Gjendja</a>
              <a href="#product-process">Porosia</a>
              <a href="#product-photo">Foto</a>
            </nav>
            <ProductFields
              slug={slug}
              product={initial}
              workflows={workflows}
              kind={kind}
              fields={fields}
              usage={usage}
              autoSuggest={!!draft}
              stock={stock}
              creating={!product}
              photoAside
            />
          </div>
        </fieldset>
        <aside className="product-side">
          <div id="product-photo">
            <ProductPhoto slug={slug} initial={initial?.image_url ?? ""} name={preview.name}
              onChange={image => setPreview(current => ({ ...current, image }))} />
          </div>
          <section className="panel section-pad">
            <h2>Gati për Agjentin</h2>
            <ReadinessList items={readiness} hrefFor={anchor => `#${anchor}`} />
          </section>
          <div className="product-save-actions" id="product-save">
            <PublishSwitch defaultChecked={initial?.is_active ?? false} />
            <button className="btn btn-primary" disabled={pending} type="submit">
              {pending ? "Duke ruajtur…" : product ? "Ruaj ndryshimet" : "Ruaj produktin"}
            </button>
            {error && (
              <p role="alert" className="form-feedback-error">
                {error}
              </p>
            )}
            {success && <p role="status">{success}</p>}
          </div>
        </aside>
      </form>
      {product && (
        <div className="products-workspace product-detail-extras">
          {/* Archive and delete: two quiet buttons; each confirmation explains what happens. */}
          <div className="product-danger-actions">
            <OperationButton slug={slug} operation={product.archived_at ? "product.restore" : "product.archive"} input={{ id: product.id }} className="product-danger-button">
              {product.archived_at ? "Rikthe si draft" : "Arkivo produktin"}
            </OperationButton>
            <OperationButton slug={slug} operation="product.delete" input={{ id: product.id }} redirectTo={`/b/${slug}/products`} className="product-danger-button catalog-bulk-danger">Fshi produktin</OperationButton>
          </div>
        </div>
      )}
    </>
  );
}
