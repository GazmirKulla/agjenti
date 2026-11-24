import { createKnowledgeEntry } from "@/lib/knowledge/commands";
import { knowledgeSourceLabel } from "@/lib/knowledge/context";
import { KnowledgeText, knowledgePreview } from "@/components/knowledge/knowledge-text";
import { ActionForm } from "@/components/dashboard/action-form";
import { RecordBrowser } from "@/components/dashboard/record-browser";
import { PageHeading } from "@/components/dashboard/ui";
import { KnowledgeSources } from "@/components/dashboard/knowledge-sources";
import { TrainingEntry } from "@/components/training/training-entry";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";
import { saveKnowledgeEntry } from "@/lib/knowledge/actions";
import { AssistantRecordContext } from "@/components/business-assistant/workspace";
import { OperationButton } from "@/components/dashboard/operation-button";
import Link from "next/link";

/** Where an entry came from, in words: never the internal key. */
function knowledgeOrigin(intent: string | null, services: boolean) {
  if (services || intent === "service") return "Shërbim";
  if (intent?.startsWith("profile:") || intent === "business_profile") return "Nga profili i biznesit";
  if (intent === "conversations") return "Nga bisedat me klientët";
  return "Informacion i biznesit";
}

export async function KnowledgeWorkspace({
  slug,
  services = false,
  openEntry,
}: {
  slug: string;
  services?: boolean;
  /** Opened from a test or another page (?entry=…), to correct it right away. */
  openEntry?: string;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await requireBusinessAccess(user.id, slug);
  if (!access) redirect("/auth/continue");
  const db = createServiceSupabase();
  const { data: entries, error: loadError } = await db
    .from("knowledge_entries")
    .select("id,title,body,intent_key,is_active,updated_at,format,source,owner_edited_at")
    .eq("business_id", access.business.id)
    .order("sort_order");
  const visibleEntries = services
    ? (entries ?? []).filter((e) => e.intent_key === "service")
    : (entries ?? []).filter((e) => e.intent_key !== "service");
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");
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
        title={services ? "Shërbimet" : "Njohuritë"}
        description={
          services
            ? "Përshkruaj shërbimet, kërkesat dhe çmimet e verifikuara që Agjenti përdor për t’iu përgjigjur klientëve."
            : "Informacioni i biznesit që Agjenti lexon kur u përgjigjet klientëve. Ndryshimet zbatohen sapo i ruan."
        }
      />
      {!services && <KnowledgeSources slug={slug} />}
      {!services && <TrainingEntry slug={slug} />}
      <RecordBrowser
        listTitle={services ? "Shërbimet" : "Njohuritë"}
        facets={[{ key: "status", label: "Përdoret nga Agjenti", options: [{ value: "active", label: "Ndezur" }, { value: "inactive", label: "Fikur" }] }]}
        initialOpenId={openEntry}
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
            {!services && <p className="muted-copy">Agjenti e përdor sapo e shton. Mund ta fikësh më vonë te “Përdoret nga Agjenti”.</p>}
            <button className="btn btn-primary" type="submit">
              {services ? "Shto shërbimin" : "Shto njohurinë"}
            </button>
          </ActionForm>
        }
        records={visibleEntries.map((e) => ({
          id: e.id,
          title: e.title,
          subtitle: knowledgePreview(e.body),
          badge: (
            <span key={e.id} className={`status-badge ${e.is_active ? "status-connected" : "status-paused"}`}>
              {services ? e.is_active ? "Aktive" : "Joaktive" : e.is_active ? "Përdoret" : "E fikur"}
            </span>
          ),
          facets: { status: e.is_active ? "active" : "inactive" },
          detail: (
            <>
              {!services && <AssistantRecordContext entityType="knowledge" entityId={e.id} selectionLabel={e.title} />}
              <div className="detail-header">
                <div>
                  <h2>{e.title}</h2>
                  <p>{services || !e.source ? knowledgeOrigin(e.intent_key, services) : knowledgeSourceLabel(e.source, e.owner_edited_at)}</p>
                </div>
                {!services && <div className="knowledge-detail-actions">
                  <Link className="btn btn-ghost" href={`/b/${slug}/agents/test?knowledge=${e.id}`}>Provo me Agjentin</Link>
                  <OperationButton slug={slug} operation="knowledge.delete" input={{ id: e.id }}>Fshi njohurinë</OperationButton>
                </div>}
              </div>
              {!e.is_active && <p className="knowledge-inactive-note">E fikur: Agjenti nuk e lexon këtë njohuri. Kontrolloje dhe ndize “Përdoret nga Agjenti” kur është e saktë.</p>}
              <div className="detail-block grid gap-2">
                <small className="muted-copy">Si e lexon Agjenti</small>
                <KnowledgeText text={e.body} format={e.format} />
                {typeof e.source?.evidence === "string" && <details><summary className="muted-copy">Teksti në burim</summary><blockquote className="muted-copy" style={{ whiteSpace: "pre-wrap" }}>{e.source.evidence}</blockquote></details>}
              </div>
              <ActionForm action={saveKnowledgeEntry.bind(null, slug)} className="grid gap-4 detail-block">
                <input type="hidden" name="id" value={e.id} />
                <input type="hidden" name="updated_at" value={e.updated_at} />
                <label className="form-label">Titulli<input name="title" className="field" defaultValue={e.title} required maxLength={500} /></label>
                <label className="form-label">Përmbajtja<textarea name="body" className="field" rows={10} defaultValue={e.body} required maxLength={8000} />
                  <small className="muted-copy">Listat me “- ”, hapat me “1. ”, tabelat me “| … |”. Agjenti i lexon siç i shkruan.</small></label>
                <label className="toggle-label knowledge-active-toggle">
                  <span>
                    Përdoret nga Agjenti
                    <small>Ndezur: Agjenti e lexon kur lidhet me pyetjen e klientit, jo në çdo mesazh. Fikur: ruhet këtu, por Agjenti nuk e lexon.</small>
                  </span>
                  <input name="is_active" type="checkbox" className="switch-input" defaultChecked={e.is_active} />
                </label>
                <button className="btn btn-primary justify-self-start" type="submit">Ruaj</button>
              </ActionForm>
            </>
          ),
        }))}
      />
    </>
  );
}
