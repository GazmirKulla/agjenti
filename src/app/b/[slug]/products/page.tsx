import {
  createProduct,
  deleteProduct,
  linkExternalProduct,
  updateProduct,
} from "@/lib/products/actions";
import { applyTypeSuggestion } from "@/lib/product-types/actions";
import { ActionForm } from "@/components/dashboard/action-form";
import Link from "next/link";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, StatusBadge, money } from "@/components/dashboard/ui";
import { redirect } from "next/navigation";
import {
  fetchLinkedCatalog,
  type ExternalCatalogProduct,
} from "@/lib/integrations/zana";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  image_url: string | null;
  source: string;
  external_id: string | null;
  price_amount: number | null;
  currency: string;
  product_type_id: string | null;
  workflow_id: string | null;
  is_active: boolean;
};

function productStatus(p: ProductRow) {
  if (!p.is_active) return "paused";
  if (p.product_type_id && p.workflow_id) return "connected";
  return "draft";
}

function ProductFields({
  product,
  types,
  workflows,
  requireType = false,
}: {
  product?: ProductRow;
  types: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
  requireType?: boolean;
}) {
  return (
    <>
      <fieldset className="grid gap-3">
        <legend className="font-semibold">Identiteti</legend>
        <label className="form-label">
          Emri i produktit
          <input
            name="name"
            className="field"
            required
            minLength={2}
            defaultValue={product?.name ?? ""}
          />
        </label>
        <label className="form-label">
          SKU / kodi
          <input
            name="sku"
            className="field"
            placeholder="opsional"
            defaultValue={product?.sku ?? ""}
          />
        </label>
        <label className="form-label">
          Përshkrimi
          <textarea
            name="description"
            className="field"
            rows={3}
            placeholder="Çfarë është produkti, materiale, madhësi tipike…"
            defaultValue={product?.description ?? ""}
          />
        </label>
        <label className="form-label">
          URL e fotos
          <input
            name="image_url"
            type="url"
            className="field"
            placeholder="https://"
            defaultValue={product?.image_url ?? ""}
          />
        </label>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="font-semibold">Çmimi</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="form-label">
            Shuma
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              className="field"
              defaultValue={product?.price_amount ?? ""}
              required={Boolean(product)}
            />
          </label>
          <label className="form-label">
            Monedha
            <input
              name="currency"
              className="field"
              maxLength={3}
              defaultValue={product?.currency ?? "ALL"}
              required
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="font-semibold">Procesi i porosisë</legend>
        <label className="form-label">
          Lloji i produktit
          <select
            name="product_type_id"
            className="field"
            defaultValue={product?.product_type_id ?? ""}
            required={requireType}
          >
            <option value="">
              {requireType ? "Zgjidh llojin" : "Pa lloj"}
            </option>
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
            name="workflow_id"
            className="field"
            defaultValue={product?.workflow_id ?? ""}
          >
            <option value="">Pa workflow</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <label className="toggle-label">
        <span>
          Aktiv në katalog
          <small>Produktet joaktive nuk i sheh Agjenti AI.</small>
        </span>
        <input
          className="switch-input"
          type="checkbox"
          name="is_active"
          defaultChecked={product?.is_active ?? true}
        />
      </label>
    </>
  );
}

export default async function ProductsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const [productResult, typeResult, workflowResult, remoteResult] =
    await Promise.all([
      db
        .from("products")
        .select(
          "id,name,description,sku,image_url,source,external_id,price_amount,currency,product_type_id,workflow_id,is_active",
        )
        .eq("business_id", access.business.id)
        .order("name"),
      db
        .from("product_types")
        .select("id,name,description")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      db
        .from("workflows")
        .select("id,name")
        .eq("business_id", access.business.id)
        .order("name"),
      access.business.catalog_source === "internal"
        ? Promise.resolve({
            products: [] as ExternalCatalogProduct[],
            error: null as string | null,
          })
        : fetchLinkedCatalog(access.business.id)
            .then((products) => ({ products, error: null as string | null }))
            .catch((error: unknown) => ({
              products: [] as ExternalCatalogProduct[],
              error:
                error instanceof Error
                  ? error.message
                  : "Katalogu i jashtëm nuk u ngarkua.",
            })),
    ]);
  if (productResult.error || typeResult.error || workflowResult.error)
    throw new Error("Nuk u ngarkuan të dhënat.");
  const products = (productResult.data ?? []) as ProductRow[];
  const types = typeResult.data ?? [];
  const workflows = workflowResult.data ?? [];
  const remote = remoteResult.products;
  const catalogError = remoteResult.error;

  return (
    <>
      <PageHeading
        eyebrow="Produkte"
        title={`Produktet e ${access.business.name}`}
        description="Katalogu që sheh Agjenti AI: emër, përshkrim, çmim, lloj dhe workflow i porosisë."
      >
        <Link href={`/b/${slug}/workflows`} className="btn btn-ghost">
          Hap workflow-t →
        </Link>
      </PageHeading>
      {catalogError && (
        <div role="status" className="catalog-notice">
          <p>{catalogError}</p>
          <Link href={`/b/${slug}/settings`}>Hap cilësimet →</Link>
        </div>
      )}
      {!types.length && (
        <div role="status" className="catalog-notice">
          <p>
            Nuk ka lloje globale aktive. Kontakto administratorin e platformës.
          </p>
        </div>
      )}
      <RecordBrowser
        listTitle="Produktet"
        placeholder="Kërko emër, SKU…"
        columns={["Emri", "Çmimi", "Lloji", "Workflow", "Status"]}
        emptyTitle="Ende nuk ka produkte"
        emptyDescription="Shto produktin e parë me emër, çmim dhe lloj."
        createLabel="Shto produkt"
        createForm={
          <ActionForm
            action={createProduct.bind(null, slug)}
            className="grid gap-5"
          >
            <ProductFields types={types} workflows={workflows} />
            <button className="btn btn-primary" type="submit">
              Ruaj produktin
            </button>
          </ActionForm>
        }
        records={products.map((p) => {
          const type = types.find((t) => t.id === p.product_type_id);
          const workflow = workflows.find((w) => w.id === p.workflow_id);
          const status = productStatus(p);
          return {
            id: p.id,
            title: p.name,
            subtitle: p.sku
              ? `SKU ${p.sku}`
              : p.source === "linked"
                ? "Katalog i lidhur"
                : "Manual",
            badge: <StatusBadge status={status} />,
            cells: [
              money(p.price_amount, p.currency),
              type?.name || "—",
              workflow?.name || "—",
              <StatusBadge key="st" status={status} />,
            ],
            detail: (
              <>
                <div className="detail-header">
                  <div>
                    <h2>{p.name}</h2>
                    <p>
                      {type?.name || "Pa lloj"}
                      {workflow ? ` · ${workflow.name}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={status} />
                </div>
                {p.image_url && (
                  <img
                    src={p.image_url}
                    alt=""
                    className="mt-4 max-h-40 w-full rounded-lg object-cover"
                  />
                )}
                <p className="text-3xl font-bold mt-4">
                  {money(p.price_amount, p.currency)}
                </p>
                {p.description && (
                  <p className="muted-copy mt-2">{p.description}</p>
                )}

                <div className="detail-block">
                  <h3>Ndrysho produktin</h3>
                  <ActionForm
                    action={updateProduct.bind(null, slug)}
                    className="grid gap-5 mt-4"
                  >
                    <input type="hidden" name="product_id" value={p.id} />
                    <ProductFields
                      product={p}
                      types={types}
                      workflows={workflows}
                      requireType
                    />
                    <button className="btn btn-primary" type="submit">
                      Ruaj ndryshimet
                    </button>
                  </ActionForm>
                </div>

                {type && (
                  <div className="detail-block">
                    <h3>Sugjerimi i llojit</h3>
                    <p className="muted-copy">
                      {type.description ||
                        "Kopjo hapat e sugjeruar të llojit në një workflow të ri dhe lidhe me këtë produkt."}
                    </p>
                    <ActionForm
                      action={applyTypeSuggestion.bind(null, slug)}
                      className="mt-4"
                    >
                      <input type="hidden" name="product_id" value={p.id} />
                      <input
                        type="hidden"
                        name="product_type_id"
                        value={type.id}
                      />
                      <button type="submit" className="btn btn-ghost">
                        Përdor sugjerimin e llojit
                      </button>
                    </ActionForm>
                  </div>
                )}

                <div className="detail-block">
                  <h3>Fshi produktin</h3>
                  <p className="muted-copy">
                    Porositë ekzistuese mbajnë referencën; produkti hiqet nga
                    katalogu.
                  </p>
                  <ActionForm
                    action={deleteProduct.bind(null, slug)}
                    className="mt-4"
                  >
                    <input type="hidden" name="product_id" value={p.id} />
                    <button type="submit" className="btn btn-ghost">
                      Fshi produktin
                    </button>
                  </ActionForm>
                </div>
              </>
            ),
          };
        })}
      />
      {remote.length > 0 && (
        <section className="panel section-pad mt-6">
          <h2 className="text-lg">Lidh produkte nga katalogu i jashtëm</h2>
          <p className="muted-copy">
            Zgjidh llojin; plotëso përshkrimin dhe workflow-in më vonë nga
            detaji.
          </p>
          <div className="mt-4 space-y-3">
            {remote.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"
              >
                <div>
                  <strong className="text-sm">{p.name}</strong>
                  <p className="muted-copy">{p.price ?? "Pa çmim"}</p>
                </div>
                <ActionForm
                  action={linkExternalProduct.bind(null, slug)}
                  className="flex flex-wrap gap-2"
                >
                  <input type="hidden" name="name" value={p.name} />
                  <input type="hidden" name="external_id" value={p.id} />
                  <input type="hidden" name="price" value={p.price ?? ""} />
                  <input type="hidden" name="currency" value="ALL" />
                  <input type="hidden" name="is_active" value="on" />
                  <select
                    aria-label={`Lloji për ${p.name}`}
                    name="product_type_id"
                    className="field"
                  >
                    <option value="">Pa lloj</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="btn btn-ghost">
                    Lidh
                  </button>
                </ActionForm>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
