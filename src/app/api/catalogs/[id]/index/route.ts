import { catalogAccess } from "@/lib/catalogs/access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { indexCatalog } from "@/lib/catalogs/indexing";
import type { Catalog } from "@/lib/catalogs/model";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let catalog: Catalog | null = null;
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return Response.json({ error: "Kërkesë e pavlefshme." }, { status: 403 });
    const { business } = await catalogAccess(
      new URL(request.url).searchParams.get("slug") ?? "",
    );
    if (!process.env.OPENAI_API_KEY)
      throw new Error("Indeksimi AI nuk është konfiguruar.");
    const { id } = await params;
    const db = createServiceSupabase();
    const claim = await db.rpc("claim_catalog_index", {
      p_id: id,
      p_business: business.id,
    });
    if (claim.error)
      throw new Error(
        "Nuk mund të nisë analiza. Maksimumi 10 analiza/orë për biznes.",
      );
    catalog = claim.data?.[0] ?? null;
    if (!catalog)
      return Response.json(
        { error: "Katalogu mungon ose po analizohet." },
        { status: 409 },
      );
    await indexCatalog(catalog);
    return Response.json({ success: true });
  } catch (e) {
    if (catalog)
      await createServiceSupabase()
        .from("catalogs")
        .update({
          index_status: "failed",
          index_error:
            "Indeksimi dështoi. Kontrollo dokumentin dhe provo përsëri.",
        })
        .eq("id", catalog.id)
        .eq("business_id", catalog.business_id)
        .eq("revision", catalog.revision)
        .eq("index_status", "indexing");
    const msg = e instanceof Error ? e.message : "";
    return Response.json(
      {
        error:
          msg === "unauthorized"
            ? "Nuk ke qasje."
            : "Analiza nuk përfundoi. Kontrollo dokumentin, konfigurimin AI dhe kufirin prej 10 analizash/orë.",
      },
      { status: msg === "unauthorized" ? 403 : 400 },
    );
  }
}
