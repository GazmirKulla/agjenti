import { ActionForm } from "@/components/dashboard/action-form";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading } from "@/components/dashboard/ui";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isExternalCatalogLinked,
  knowledgeUrlFromCatalog,
  loadBusinessApiSecret,
  loadBusinessCatalogUrl,
} from "@/lib/integrations/zana";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

export async function KnowledgeWorkspace({
  slug,
  services = false,
}: {
  slug: string;
  services?: boolean;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const { data: entries, error: loadError } = await db
    .from("knowledge_entries")
    .select("id,title,body,intent_key")
    .eq("business_id", access.business.id)
    .order("sort_order");
  const visibleEntries = services
    ? (entries ?? []).filter((e) => e.intent_key === "service")
    : (entries ?? []).filter((e) => e.intent_key !== "service");
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");
  const linked = await isExternalCatalogLinked(access.business.id);

  async function importExternalFaq() {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    if (!(await isExternalCatalogLinked(acc.business.id)))
      return {
        error:
          "Lidh më parë një katalog të jashtëm te Cilësimet për të importuar FAQ.",
      };
    const catalogUrl = await loadBusinessCatalogUrl(acc.business.id);
    const secret = await loadBusinessApiSecret(acc.business.id);
    const knowledgeUrl = catalogUrl
      ? knowledgeUrlFromCatalog(catalogUrl)
      : null;
    if (!knowledgeUrl || !secret)
      return {
        error:
          "Lidhja nuk është konfiguruar. Vendos URL-në e katalogut (.../catalog) dhe API key te Cilësimet.",
      };
    const res = await fetch(knowledgeUrl, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok)
      return { error: "Njohuritë nuk u morën nga API. Provo përsëri." };
    const json = (await res.json()) as {
      entries: Array<{
        question: string;
        answer: string;
        intent_key: string | null;
        sort_order: number;
      }>;
    };
    const db = createServiceSupabase();
    for (const entry of json.entries ?? []) {
      await db
        .from("knowledge_entries")
        .insert({
          business_id: acc.business.id,
          title: entry.question,
          body: entry.answer,
          intent_key: entry.intent_key,
          sort_order: entry.sort_order ?? 0,
        })
        .throwOnError();
    }
    revalidatePath(`/b/${slug}`, "layout");
  }

  async function add(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    if (
      !String(formData.get("title") || "").trim() ||
      !String(formData.get("body") || "").trim()
    )
      return { error: "Vendos titullin dhe përmbajtjen e njohurisë." };
    await createServiceSupabase()
      .from("knowledge_entries")
      .insert({
        business_id: acc.business.id,
        title: String(formData.get("title") ?? "").trim(),
        body: String(formData.get("body") ?? "").trim(),
        intent_key: services
          ? "service"
          : String(formData.get("intent_key") ?? "").trim() || null,
      })
      .throwOnError();
    revalidatePath(`/b/${slug}`, "layout");
  }

  return (
    <>
      <PageHeading
        eyebrow={services ? "Shërbime" : "Njohuria"}
        title={access.business.name}
        description={
          services
            ? "Përshkruaj shërbimet, kërkesat dhe çmimet e verifikuara që Agjenti përdor për t’iu përgjigjur klientëve."
            : "Njohuritë e biznesit që Agjenti AI përdor për t’iu përgjigjur klientëve."
        }
      >
        {linked && !services && (
          <ActionForm action={importExternalFaq}>
            <button className="btn btn-ghost" type="submit">
              Importo FAQ nga API
            </button>
          </ActionForm>
        )}
      </PageHeading>
      <RecordBrowser
        listTitle={services ? "Shërbimet" : "Njohuritë"}
        placeholder="Kërko në njohuri…"
        createLabel={services ? "Shto shërbim" : "Shto njohuri"}
        createForm={
          <ActionForm action={add} className="grid gap-4">
            <label className="form-label">
              Titulli
              <input name="title" className="field" required />
            </label>
            <label className="form-label">
              Identifikuesi i qëllimit (opsional)
              <input name="intent_key" className="field" />
            </label>
            <label className="form-label">
              Përmbajtja
              <textarea name="body" className="field" rows={10} required />
            </label>
            <button className="btn btn-primary" type="submit">
              {services ? "Shto shërbimin" : "Shto njohurinë"}
            </button>
          </ActionForm>
        }
        records={visibleEntries.map((e) => ({
          id: e.id,
          title: e.title,
          subtitle: e.body,
          badge: (
            <span className="status-badge">
              {services ? "Shërbim" : "Njohuri"}
            </span>
          ),
          detail: (
            <>
              <div className="detail-header">
                <div>
                  <h2>{e.title}</h2>
                  <p>{e.intent_key || "Informacion i biznesit"}</p>
                </div>
              </div>
              <div className="detail-block">
                <h3>Përmbajtja</h3>
                <p className="whitespace-pre-wrap text-sm leading-7 text-ink-muted">
                  {e.body}
                </p>
              </div>
            </>
          ),
        }))}
      />
    </>
  );
}
