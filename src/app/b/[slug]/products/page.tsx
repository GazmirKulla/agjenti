import { ActionForm } from "@/components/dashboard/action-form";
import Link from "next/link";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading, StatusBadge, money } from "@/components/dashboard/ui";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  fetchLinkedCatalog,
  type ExternalCatalogProduct,
} from "@/lib/integrations/zana";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

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
  const { data: products, error: loadError } = await db
    .from("products")
    .select("id,name,source,external_id,price_amount,currency,product_type_id")
    .eq("business_id", access.business.id)
    .order("name");
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");
  const { data: types } = await db
    .from("product_types")
    .select("id,name")
    .eq("business_id", access.business.id);
  let remote: ExternalCatalogProduct[] = [];
  let catalogError: string | null = null;
  if (access.business.catalog_source !== "internal") {
    try {
      remote = await fetchLinkedCatalog(access.business.id);
    } catch (error) {
      catalogError =
        error instanceof Error
          ? error.message
          : "Katalogu i jashtëm nuk u ngarkua.";
    }
  }

  async function addManual(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Vendos emrin e produktit." };
    const priceText = String(formData.get("price") ?? "").trim();
    const price = priceText ? Number(priceText) : null;
    if (price !== null && (!Number.isFinite(price) || price < 0))
      return { error: "Çmimi duhet të jetë numër pozitiv ose zero." };
    const typeId = String(formData.get("product_type_id") || "");
    if (typeId) {
      const { data: type } = await createServiceSupabase()
        .from("product_types")
        .select("id")
        .eq("id", typeId)
        .eq("business_id", acc.business.id)
        .maybeSingle();
      if (!type)
        return { error: "Lloji i produktit nuk u gjet në këtë biznes." };
    }
    await createServiceSupabase()
      .from("products")
      .insert({
        business_id: acc.business.id,
        name,
        price_amount: price,
        product_type_id: String(formData.get("product_type_id") || "") || null,
        source: "manual",
      })
      .throwOnError();
    revalidatePath(`/b/${slug}/products`);
  }

  async function linkProduct(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    const supabase = createServiceSupabase();
    const externalId = String(formData.get("external_id") ?? "");
    if (!externalId || !String(formData.get("name") || "").trim())
      return { error: "Produkti i jashtëm nuk është i vlefshëm." };
    const priceText = String(formData.get("price") ?? "").trim();
    const price = priceText ? Number(priceText) : null;
    if (price !== null && (!Number.isFinite(price) || price < 0))
      return { error: "Çmimi i produktit nuk është i vlefshëm." };
    const typeId = String(formData.get("product_type_id") || "");
    if (typeId) {
      const { data: type } = await supabase
        .from("product_types")
        .select("id")
        .eq("id", typeId)
        .eq("business_id", acc.business.id)
        .maybeSingle();
      if (!type)
        return { error: "Lloji i produktit nuk u gjet në këtë biznes." };
    }
    const { data: existing, error: existingError } = await supabase
      .from("products")
      .select("id")
      .eq("business_id", acc.business.id)
      .eq("external_id", externalId)
      .maybeSingle();
    if (existingError)
      return { error: "Nuk u verifikua lidhja e produktit. Provo përsëri." };
    const row = {
      business_id: acc.business.id,
      name: String(formData.get("name") ?? ""),
      external_id: externalId,
      product_type_id: String(formData.get("product_type_id") || "") || null,
      source: "linked" as const,
      price_amount: price,
    };
    if (existing)
      await supabase
        .from("products")
        .update(row)
        .eq("id", existing.id)
        .throwOnError();
    else await supabase.from("products").insert(row).throwOnError();
    revalidatePath(`/b/${slug}/products`);
  }

  return (
    <>
      <PageHeading
        eyebrow="Produkte"
        title={`Produktet e ${access.business.name}`}
        description="Menaxho katalogun dhe lidh produktet me workflow-t sipas llojit."
      />
      {catalogError && (
        <div role="status" className="catalog-notice">
          <p>{catalogError}</p>
          <Link href={`/b/${slug}/settings`}>Hap cilësimet →</Link>
        </div>
      )}
      <RecordBrowser
        listTitle="Produktet"
        placeholder="Kërko produkt…"
        createLabel="Shto produkt"
        createForm={
          <ActionForm action={addManual} className="grid gap-4">
            <label className="form-label">
              Emri i produktit
              <input name="name" className="field" required />
            </label>
            <label className="form-label">
              Çmimi (ALL)
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                className="field"
              />
            </label>
            <label className="form-label">
              Lloji i produktit
              <select name="product_type_id" className="field">
                <option value="">Pa lloj</option>
                {(types ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" type="submit">
              Ruaj produktin
            </button>
          </ActionForm>
        }
        records={(products ?? []).map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: money(p.price_amount, p.currency),
          badge: <StatusBadge status={p.source} />,
          detail: (
            <>
              <div className="detail-header">
                <div>
                  <h2>{p.name}</h2>
                  <p>
                    {types?.find((t) => t.id === p.product_type_id)?.name ||
                      "Pa lloj të caktuar"}
                  </p>
                </div>
                <StatusBadge status={p.source} />
              </div>
              <p className="text-3xl font-bold">
                {money(p.price_amount, p.currency)}
              </p>
              <div className="detail-block">
                <h3>Informacioni i produktit</h3>
                <dl className="detail-fields">
                  <div>
                    <dt>Emri</dt>
                    <dd>{p.name}</dd>
                  </div>
                  <div>
                    <dt>Burimi</dt>
                    <dd>
                      {p.source === "linked" ? "Katalog i lidhur" : "Manual"}
                    </dd>
                  </div>
                  <div>
                    <dt>Referenca e jashtme</dt>
                    <dd>{p.external_id || "—"}</dd>
                  </div>
                  <div>
                    <dt>Lloji</dt>
                    <dd>
                      {types?.find((t) => t.id === p.product_type_id)?.name ||
                        "—"}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="detail-block">
                <h3>Workflow AI</h3>
                <p className="muted-copy">
                  Agjenti ndjek workflow-n e llojit të produktit për të mbledhur
                  informacionin e porosisë.
                </p>
                <Link className="soft-link" href={`/b/${slug}/workflows`}>
                  Shiko workflow-t
                </Link>
              </div>
            </>
          ),
        }))}
      />
      {remote.length > 0 && (
        <section className="panel section-pad mt-6">
          <h2 className="text-lg">Lidh produkte nga katalogu i jashtëm</h2>
          <p className="muted-copy">
            Zgjidh llojin për t’i lidhur me workflow-n përkatës.
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
                <ActionForm action={linkProduct} className="flex gap-2">
                  <input type="hidden" name="name" value={p.name} />
                  <input type="hidden" name="external_id" value={p.id} />
                  <input type="hidden" name="price" value={p.price ?? ""} />
                  <select
                    aria-label={`Lloji për ${p.name}`}
                    name="product_type_id"
                    className="field"
                  >
                    <option value="">Pa lloj</option>
                    {(types ?? []).map((t) => (
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
