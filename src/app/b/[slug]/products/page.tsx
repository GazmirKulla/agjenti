import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchLinkedCatalog } from "@/lib/integrations/zana";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export default async function ProductsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/app");
  const db = createServiceSupabase();
  const { data: products } = await db
    .from("products")
    .select("id,name,source,external_id,price_amount,product_type_id")
    .eq("business_id", access.business.id)
    .order("name");
  const { data: types } = await db
    .from("product_types")
    .select("id,name")
    .eq("business_id", access.business.id);
  const remote =
    access.business.catalog_source === "internal" ? [] : await fetchLinkedCatalog(access.business.id);

  async function addManual(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return;
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return;
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    await createServiceSupabase().from("products").insert({
      business_id: acc.business.id,
      name,
      price_amount: Number(formData.get("price") || 0) || null,
      product_type_id: String(formData.get("product_type_id") || "") || null,
      source: "manual",
    });
    revalidatePath(`/b/${slug}/products`);
  }

  async function linkProduct(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return;
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return;
    const supabase = createServiceSupabase();
    const externalId = String(formData.get("external_id") ?? "");
    const { data: existing } = await supabase
      .from("products")
      .select("id")
      .eq("business_id", acc.business.id)
      .eq("external_id", externalId)
      .maybeSingle();
    const row = {
      business_id: acc.business.id,
      name: String(formData.get("name") ?? ""),
      external_id: externalId,
      product_type_id: String(formData.get("product_type_id") || "") || null,
      source: "linked" as const,
      price_amount: Number(formData.get("price") || 0) || null,
    };
    if (existing) await supabase.from("products").update(row).eq("id", existing.id);
    else await supabase.from("products").insert(row);
    revalidatePath(`/b/${slug}/products`);
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Produkte</h1>
      <form action={addManual} className="grid max-w-lg gap-2 panel p-4">
        <p className="font-medium">Shto me dorë</p>
        <input name="name" placeholder="Emri" className="field" required />
        <input name="price" placeholder="Çmimi" className="field" />
        <select name="product_type_id" className="field">
          <option value="">Lloji</option>
          {(types ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" type="submit">
          Ruaj
        </button>
      </form>
      {remote.length > 0 ? (
        <section>
          <h2 className="mb-2 font-medium">Lidh nga faqja</h2>
          <ul className="space-y-2">
            {remote.map((p) => (
              <li key={p.id} className="flex items-center justify-between panel px-3 py-2">
                <span>
                  {p.name} {p.price != null ? `· ${p.price}` : ""}
                </span>
                <form action={linkProduct} className="flex gap-2">
                  <input type="hidden" name="name" value={p.name} />
                  <input type="hidden" name="external_id" value={p.id} />
                  <input type="hidden" name="price" value={p.price ?? ""} />
                  <select name="product_type_id" className="field py-1 text-sm">
                    <option value="">Lloji</option>
                    {(types ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-ghost px-3 py-1 text-sm" type="submit">
                    Lidh
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ul className="space-y-2">
        {(products ?? []).map((p) => (
          <li key={p.id} className="panel px-3 py-2">
            {p.name} · {p.source}
            {p.external_id ? ` · ${p.external_id}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
