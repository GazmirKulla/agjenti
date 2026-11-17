import { redirect } from "next/navigation";
import { ProductHeading } from "@/components/products/shared";
import { ProductFieldsSettings } from "@/components/products/product-fields-settings";
import { loadItemSetup } from "@/lib/items/business";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

/** The fields the business's products have, next to the products themselves. */
export default async function ProductFieldsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: requested } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, requested);
  if (!access) redirect("/auth/continue");
  const slug = access.business.slug;
  const items = await loadItemSetup(access.business.id);
  return (
    <>
      <ProductHeading
        slug={slug}
        names={items.names}
        actions="none"
        back={{ href: `/b/${slug}/products`, label: items.names.plural }}
        title="Fushat"
        description={`Të dhënat që ka çdo ${items.names.singular}. I plotëson kur shton ose ndryshon një ${items.names.singular}; Agjenti ua tregon klientëve dhe i përdor te porosia.`}
      />
      {!items.fieldsRead
        ? <p className="form-feedback form-feedback-error" role="alert">Fushat nuk u lexuan. Rifresko faqen.</p>
        : <ProductFieldsSettings slug={slug} fields={items.fields} />}
    </>
  );
}
