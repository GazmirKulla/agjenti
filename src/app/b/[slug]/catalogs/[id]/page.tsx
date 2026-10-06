import { notFound } from "next/navigation";
import { catalogAccess } from "@/lib/catalogs/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { parseMetadata, type Catalog } from "@/lib/catalogs/model";
import { CatalogDetail } from "@/components/catalogs/detail";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { business } = await catalogAccess(slug);
  const db = createServiceSupabase();
  const result = await db
    .from("catalogs")
    .select("*")
    .eq("business_id", business.id)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error("Katalogu nuk u ngarkua.");
  if (!result.data) notFound();
  const c = {
    ...result.data,
    metadata: parseMetadata(result.data.metadata),
  } as Catalog;
  const sections = await db
    .from("catalog_sections")
    .select("id,heading,body,page")
    .eq("business_id", business.id)
    .eq("catalog_id", id)
    .order("position");
  if (sections.error) throw new Error("Indeksi nuk u ngarkua.");
  const signed = c.storage_path
    ? await db.storage
        .from("business-catalogs")
        .createSignedUrl(c.storage_path, 300, { download: true })
    : null;
  const source = signed?.data?.signedUrl || c.source_url;
  return (
    <CatalogDetail
      c={c}
      slug={slug}
      source={source}
      sections={sections.data ?? []}
    />
  );
}
