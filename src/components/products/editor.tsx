"use client";
import { OperationButton } from "@/components/dashboard/operation-button";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProductFields } from "@/components/dashboard/product-fields";
import {
  createProduct,
  updateProduct,
} from "@/lib/products/actions";
import { applyTypeSuggestion } from "@/lib/product-types/actions";
import { ActionForm } from "@/components/dashboard/action-form";
import { ProductTips } from "./shared";
import { ProductPhoto } from "./product-photo";
import type { ProductRow, Option } from "@/lib/products/catalog";
import { usePageAssistantContext } from "@/components/business-assistant/workspace";
export function ProductEditor({
  slug,
  product,
  types,
  workflows,
  kind,
  fields = [],
  usage,
  draft,
}: {
  slug: string;
  product?: ProductRow;
  types: Option[];
  workflows: Option[];
  /** The item kind (product, property…); adds its own fields to the form. */
  kind?: string;
  fields?: import("@/lib/items/fields").BusinessField[];
  usage?: import("@/lib/items/field-visibility").FieldUsage;
  /** A new product prefilled from another source (e.g. a website page); saved as a new product. */
  draft?: Partial<ProductRow>;
}) {
  const initial = product ?? draft;
  usePageAssistantContext(product ? { entityType: "product", entityId: product.id, selectionLabel: product.name } : {});
  const businessWorkflow = workflows.find(w => w.businessWorkflow)?.businessWorkflow;
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
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const checks = [
    ["Emri i produktit", preview.name.trim().length >= 2],
    ["Çmimi i produktit", preview.price !== null || preview.mode === "request"],
    ["Workflow për veprime (veçmas katalogut)", !!preview.workflow || !!product?.visual_workflow || !!businessWorkflow?.active],
    ["Foto e produktit", !!preview.image],
  ] as const;
  const completed = checks.filter(([, ok]) => ok).length;
  return (
    <>
      <form
        className="product-editor products-workspace"
        onInput={(e) => {
          const form = e.currentTarget;
          const d = new FormData(form);
          const price = String(d.get("price") ?? ""), max = String(d.get("price_max") ?? "");
          setPreview({
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
          });
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
                <p className="muted-copy">
                  {product.sku ? `SKU: ${product.sku}` : "Pa SKU"}
                </p>
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
              <a href="#product-pricing">Çmimi</a>
              <a href="#product-process">Workflow</a>
              <a href="#product-media">Foto</a>
            </nav>
            <ProductFields
              slug={slug}
              product={initial}
              types={types}
              workflows={workflows}
              kind={kind}
              fields={fields}
              usage={usage}
              autoSuggest={!!draft}
              creating={!product}
              photoAside
            />
          </div>
        </fieldset>
        <aside className="product-side">
          <ProductPhoto slug={slug} initial={initial?.image_url ?? ""} name={preview.name}
            onChange={image => setPreview(current => ({ ...current, image }))} />
          <section className="panel section-pad">
            <h2>Plotësimi i informacionit</h2>
            <strong>
              {completed} nga {checks.length} fusha të plota
            </strong>
            <progress value={completed} max={checks.length} />
            <ul className="product-checklist">
              {checks.map(([label, ok]) => (
                <li key={label} className={ok ? "is-complete" : ""}>
                  <span aria-hidden>{ok ? "✓" : "○"}</span>
                  {label}
                  {label === "Foto e produktit" ? " (opsionale)" : ""}
                </li>
              ))}
            </ul>
          </section>
          <div className="product-save-actions">
            <button
              className="btn btn-primary"
              disabled={pending}
              type="submit"
              name="save_mode"
              value="save"
            >
              {pending
                ? "Duke ruajtur…"
                : product
                  ? "Ruaj ndryshimet"
                  : "Ruaj produktin"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={pending}
              type="submit"
              name="save_mode"
              value="draft"
            >
              Ruaj si draft
            </button>
            {error && (
              <p role="alert" className="form-feedback-error">
                {error}
              </p>
            )}
            {success && <p role="status">{success}</p>}
            <p className="muted-copy">
              Aktiv në katalog do të thotë i kërkueshëm dhe i rekomandueshëm. Porositja kërkon workflow dhe autorizim të veçantë. Draftet nuk u shfaqen klientëve.
            </p>
          </div>
        </aside>
      </form>
      {product && (
        <div className="products-workspace product-detail-extras">
          <section className="panel section-pad">
            <h2>Proces i posaçëm i porosisë (opsional)</h2>
            <p className="muted-copy">
              {product.visual_workflow ? `Produkti ndjek rrjedhën “${product.visual_workflow.name}”. Hapat ndryshohen te Workflow.` : types.find((t) => t.id === product.product_type_id)
                ?.description ||
                "Workflow-i kryesor drejton mesazhet. Shto një proces të posaçëm vetëm nëse ky produkt kërkon hapa të tjerë."}
            </p>
            {product.product_type_id && !product.visual_workflow && (
              <ActionForm action={applyTypeSuggestion.bind(null, slug)}>
                <input type="hidden" name="product_id" value={product.id} />
                <input
                  type="hidden"
                  name="product_type_id"
                  value={product.product_type_id}
                />
                <button className="btn btn-ghost">
                  Përdor sugjerimin e llojit
                </button>
              </ActionForm>
            )}
            <OperationButton slug={slug} operation={product.archived_at ? "product.restore" : "product.archive"} input={{ id: product.id }}>
              {product.archived_at ? "Rikthe si draft" : "Arkivo produktin"}
            </OperationButton>
            <OperationButton slug={slug} operation="product.delete" input={{ id: product.id }} redirectTo={`/b/${slug}/products`}>Fshi produktin</OperationButton>
          </section>
          <ProductTips />
        </div>
      )}
    </>
  );
}
