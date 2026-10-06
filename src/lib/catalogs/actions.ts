"use server";
import { revalidatePath } from "next/cache";
import { catalogAccess } from "./access";
import {
  parseMetadata,
  metadataLabels,
  ruleLabels,
  qualificationLabels,
} from "./model";
import { createServiceSupabase } from "@/lib/supabase/service";
export async function saveCatalog(slug: string, id: string, form: FormData) {
  const { business } = await catalogAccess(slug);
  const db = createServiceSupabase();
  const row = await db
    .from("catalogs")
    .select("index_status,revision,confirmed_at")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!row.data || row.error) return { error: "Katalogu nuk u gjet." };
  const revision = Number(form.get("revision"));
  if (revision !== row.data.revision || row.data.index_status === "indexing")
    return { error: "Katalogu ndryshoi ose po analizohet. Rifresko faqen." };
  const active = form.get("active") === "on";
  const confirmed = form.get("confirm") === "on";
  if (
    active &&
    (!confirmed || !["review", "ready"].includes(row.data.index_status))
  )
    return {
      error: "Indekso katalogun dhe konfirmo përmbajtjen para aktivizimit.",
    };
  const title = String(form.get("title") ?? "")
    .trim()
    .slice(0, 180);
  if (!title) return { error: "Titulli kërkohet." };
  const metadata = parseMetadata(
    Object.fromEntries(
      Object.keys(metadataLabels).map((k) => [
        k,
        String(form.get(k) ?? "").split(","),
      ]),
    ),
  );
  const result = await db
    .from("catalogs")
    .update({
      title,
      description: String(form.get("description") ?? "").slice(0, 4000),
      metadata,
      use_when: form
        .getAll("use_when")
        .map(String)
        .filter((s) => Object.hasOwn(ruleLabels, s)),
      qualification_fields: form
        .getAll("qualification_fields")
        .map(String)
        .filter((s) => Object.hasOwn(qualificationLabels, s)),
      active,
      index_status:
        confirmed && ["review", "ready"].includes(row.data.index_status)
          ? "ready"
          : row.data.index_status,
      confirmed_at: confirmed ? new Date().toISOString() : null,
      revision: revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("business_id", business.id)
    .eq("revision", revision)
    .select("id");
  if (result.error || !result.data?.length)
    return { error: "Ndryshimet nuk u ruajtën. Rifresko faqen." };
  revalidatePath(`/b/${slug}/catalogs`, "layout");
  revalidatePath(`/b/${slug}/catalogs`);
  return { success: "Katalogu u ruajt." };
}
