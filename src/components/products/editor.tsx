"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ProductFields } from "@/components/dashboard/product-fields";
import {
  createProduct,
  updateProduct,
  deleteProduct,
} from "@/lib/products/actions";
import { applyTypeSuggestion } from "@/lib/product-types/actions";
import { ActionForm } from "@/components/dashboard/action-form";
import { productMoney as money } from "@/lib/products/catalog";
import { ProductTips } from "./shared";
import type { ProductRow, Option } from "@/lib/products/catalog";
export function ProductEditor({
  slug,
  product,
  types,
  workflows,
}: {
  slug: string;
  product?: ProductRow;
  types: Option[];
  workflows: Option[];
}) {
  const [preview, setPreview] = useState({
    name: product?.name ?? "",
    description: product?.description ?? "",
    image: product?.image_url ?? "",
    price: product?.price_amount ?? (null as number | null),
    currency: product?.currency ?? "ALL",
    type: product?.product_type_id ?? "",
    workflow: product?.workflow_id ?? "",
    active: product?.is_active ?? false,
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const checks = [
    ["Emri i produktit", preview.name.trim().length >= 2],
    ["Çmimi i produktit", preview.price !== null],
    ["Lloji i produktit", !!preview.type],
    ["Workflow i biznesit", !!preview.workflow],
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
          const price = String(d.get("price") ?? "");
          setPreview({
            name: String(d.get("name") ?? ""),
            description: String(d.get("description") ?? ""),
            image: String(d.get("image_url") ?? ""),
            price: price === "" ? null : Number(price),
            currency: String(d.get("currency") ?? "ALL"),
            type: String(d.get("product_type_id") ?? ""),
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
            <input type="hidden" name="product_id" value={product.id} />
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
          <nav
            className="product-editor-nav"
            aria-label="Seksionet e produktit"
          >
            <a href="#product-identity">Përmbledhje</a>
            <a href="#product-media">Media</a>
            <a href="#product-pricing">Çmimi</a>
            <a href="#product-process">Workflow</a>
          </nav>
          <ProductFields
            slug={slug}
            product={product}
            types={types}
            workflows={workflows}
          />
        </fieldset>
        <aside className="product-side">
          <section className="panel section-pad product-live-preview">
            <h2>Pamje paraprake</h2>
            <div className="product-preview-photo">
              {preview.image && /^https?:\/\//.test(preview.image) ? (
                <img src={preview.image} alt="Pamje e produktit" />
              ) : (
                <span>□</span>
              )}
            </div>
            <h3>{preview.name || "Emri i produktit"}</h3>
            <strong>{money(preview.price, preview.currency)}</strong>
            <p>{types.find((t) => t.id === preview.type)?.name || "Pa lloj"}</p>
            <span className="product-tag">
              {workflows.find((w) => w.id === preview.workflow)?.name ||
                "Pa workflow"}
            </span>
          </section>
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
              Draftet nuk përdoren nga Agjenti. Për aktivizim kërkohen çmimi,
              lloji dhe workflow.
            </p>
          </div>
        </aside>
      </form>
      {product && (
        <div className="products-workspace product-detail-extras">
          <section className="panel section-pad">
            <h2>Workflow i produktit</h2>
            <p className="muted-copy">
              {types.find((t) => t.id === product.product_type_id)
                ?.description ||
                "Lidh workflow-n te Procesi i porosisë. Mund të përdorësh sugjerimin e llojit."}
            </p>
            {product.product_type_id && (
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
            <button
              className="btn btn-ghost product-delete"
              disabled={pending}
              type="button"
              onClick={() => {
                if (!window.confirm(`Ta fshijmë produktin “${product.name}”?`))
                  return;
                const d = new FormData();
                d.set("product_id", product.id);
                start(async () => {
                  try {
                    const r = await deleteProduct(slug, d);
                    if (r.error) setError(r.error);
                    else {
                      router.push(`/b/${slug}/products`);
                      router.refresh();
                    }
                  } catch {
                    setError("Produkti nuk u fshi.");
                  }
                });
              }}
            >
              Fshi produktin
            </button>
          </section>
          <ProductTips />
        </div>
      )}
    </>
  );
}
