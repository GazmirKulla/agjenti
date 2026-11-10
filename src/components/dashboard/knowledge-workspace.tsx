import { createKnowledgeEntry } from "@/lib/knowledge/commands";
import { ActionForm } from "@/components/dashboard/action-form";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading } from "@/components/dashboard/ui";
import { KnowledgeSources } from "@/components/dashboard/knowledge-sources";
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
import { saveKnowledgeEntry } from "@/lib/knowledge/actions";
import { AssistantRecordContext } from "@/components/business-assistant/workspace";
import { OperationButton } from "@/components/dashboard/operation-button";

/** Where an entry came from, in words: never the internal key. */
function knowledgeOrigin(intent: string | null, services: boolean) {
  if (services || intent === "service") return "Shërbim";
  if (intent?.startsWith("profile:") || intent === "business_profile") return "Nga profili i biznesit";
  return "Informacion i biznesit";
}

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
    .select("id,title,body,intent_key,is_active,updated_at")
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
    // A repeated import updates the same questions instead of adding copies.
    const { data: current } = await db.from("knowledge_entries").select("id,title")
      .eq("business_id", acc.business.id).or("intent_key.is.null,intent_key.neq.service");
    const byTitle = new Map((current ?? []).map((row) => [row.title.trim().toLocaleLowerCase(), row.id]));
    for (const entry of json.entries ?? []) {
      if (typeof entry.question !== "string" || typeof entry.answer !== "string" || !entry.question.trim()) continue;
      const values = { title: entry.question.trim(), body: entry.answer, intent_key: entry.intent_key === "service" ? null : entry.intent_key, sort_order: entry.sort_order ?? 0 };
      const existing = byTitle.get(values.title.toLocaleLowerCase());
      if (existing) await db.from("knowledge_entries").update({ ...values, updated_at: new Date().toISOString() }).eq("id", existing).eq("business_id", acc.business.id).throwOnError();
      else {
        const { data: created } = await db.from("knowledge_entries").insert({ business_id: acc.business.id, ...values }).select("id").single().throwOnError();
        if (created) byTitle.set(values.title.toLocaleLowerCase(), created.id);
      }
    }
    revalidatePath(`/b/${slug}`, "layout");
  }

  async function add(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    if (services) formData.set("intent_key", "service");
    const result = await createKnowledgeEntry({ userId: session.id, business: acc.business }, formData);
    if (result.error) return result;
    revalidatePath(`/b/${slug}`, "layout");
  }

  return (
    <>
      <PageHeading
        eyebrow={access.business.name}
        title={services ? "Shërbimet" : "Njohuritë"}
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
      {!services && <KnowledgeSources slug={slug} />}
      <RecordBrowser
        listTitle={services ? "Shërbimet" : "Njohuritë"}
        facets={[{ key: "status", label: "Statusi", options: [{ value: "active", label: "Aktive" }, { value: "inactive", label: "Joaktive" }] }]}
        placeholder="Kërko në njohuri…"
        createLabel={services ? "Shto shërbim" : "Shto njohuri"}
        createForm={
          <ActionForm action={add} className="grid gap-4">
            <label className="form-label">
              Titulli
              <input name="title" className="field" required maxLength={500} placeholder="p.sh. Dërgesa" />
            </label>
            <label className="form-label">
              Përmbajtja
              <textarea name="body" className="field" rows={8} required maxLength={8000} placeholder="Si e merr klienti porosinë, sa kushton dërgesa, sa zgjat…" />
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
            <span key={e.id} className={`status-badge ${e.is_active ? "status-connected" : "status-paused"}`}>
              {e.is_active ? "Aktive" : "Joaktive"}
            </span>
          ),
          facets: { status: e.is_active ? "active" : "inactive" },
          detail: (
            <>
              {!services && <AssistantRecordContext entityType="knowledge" entityId={e.id} selectionLabel={e.title} />}
              <div className="detail-header">
                <div>
                  <h2>{e.title}</h2>
                  <p>{knowledgeOrigin(e.intent_key, services)}</p>
                </div>
                {!services && <OperationButton slug={slug} operation="knowledge.delete" input={{ id: e.id }}>Fshi njohurinë</OperationButton>}
              </div>
              {!e.is_active && <p className="knowledge-inactive-note">Kjo njohuri nuk përdoret nga Agjenti. Kontrolloje dhe aktivizoje kur është e saktë.</p>}
              <ActionForm action={saveKnowledgeEntry.bind(null, slug)} className="grid gap-4 detail-block">
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="updated_at" value={e.updated_at} />
                <label className="form-label">Titulli<input name="title" className="field" defaultValue={e.title} required maxLength={500} /></label>
                <label className="form-label">Përmbajtja<textarea name="body" className="field" rows={10} defaultValue={e.body} required maxLength={8000} /></label>
                <label className="toggle-label knowledge-active-toggle">
                  <span>
                    Përdore në përgjigjet e Agjentit
                    <small>Kur është fikur, njohuria ruhet këtu por Agjenti nuk e lexon.</small>
                  </span>
                  <input name="is_active" type="checkbox" className="switch-input" defaultChecked={e.is_active} />
                </label>
                <button className="btn btn-primary justify-self-start" type="submit">Ruaj ndryshimet</button>
              </ActionForm>
            </>
          ),
        }))}
      />
    </>
  );
}
