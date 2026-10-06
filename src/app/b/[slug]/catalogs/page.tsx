import { catalogAccess } from "@/lib/catalogs/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { parseMetadata, type Catalog } from "@/lib/catalogs/model";
import { CatalogList } from "@/components/catalogs/list";
import { CreateCatalog } from "@/components/catalogs/create";
import { PageHeading } from "@/components/dashboard/ui";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { business } = await catalogAccess(slug);
  const { data, error } = await createServiceSupabase()
    .from("catalogs")
    .select("*")
    .eq("business_id", business.id)
    .order("updated_at", { ascending: false });
  if (error)
    throw new Error(
      "Katalogët nuk u ngarkuan. Kontrollo migrimin e databazës.",
    );
  const catalogs = (data ?? []).map((c) => ({
    ...c,
    metadata: parseMetadata(c.metadata),
  })) as Catalog[];
  return (
    <>
      <PageHeading
        eyebrow="Katalogë"
        title={`Katalogët e ${business.name}`}
        description="Broshura, koleksione, lista çmimesh dhe dokumente teknike. Agjenti zgjedh materialin sipas pyetjes së klientit."
      >
        <a className="btn btn-primary" href="#catalog-create">
          Shto katalog
        </a>
      </PageHeading>
      <div className="catalog-columns">
        <CatalogList catalogs={catalogs} slug={slug} />
        <CreateCatalog slug={slug} />
      </div>
    </>
  );
}
