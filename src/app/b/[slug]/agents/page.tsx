import { InstructionFacts } from "@/components/agents/instruction-facts";
import { CommunicationEditor, type CommunicationEditorAgent } from "@/components/agents/communication-editor";
import { prepareCommunicationConfiguration, saveCommunicationConfiguration, communicationConfigurationColumns } from "@/lib/agents/communication-configuration";
import { prepareManagedAgent, saveManagedAgent } from "@/lib/agents/manage";
import { ActionForm } from "@/components/dashboard/action-form";
import Link from "next/link";
import { PageHeading } from "@/components/dashboard/ui";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, requireBusinessAccess } from "@/lib/tenant/access";

async function loadAgentLimit(businessId: string) {
  const db = createServiceSupabase();
  const { data, error } = await db
    .from("businesses")
    .select("allow_multiple_agents")
    .eq("id", businessId)
    .maybeSingle();
  if (error && ["42P01", "PGRST205", "42703"].includes(error.code)) {
    return { allowMultiple: false, maxAgents: 1 };
  }
  if (error) throw new Error("Nuk u ngarkuan të dhënat.");
  const allowMultiple = Boolean(data?.allow_multiple_agents);
  return { allowMultiple, maxAgents: allowMultiple ? 2 : 1 };
}

export default async function AgentsPage({
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
  const [{ data: agents, error: loadError }, limit] = await Promise.all([
    db
      .from("ai_agents")
      .select(communicationConfigurationColumns)
      .eq("business_id", access.business.id),
    loadAgentLimit(access.business.id),
  ]);
  if (loadError) throw new Error("Nuk u ngarkuan të dhënat.");
  const history = await db.from("agent_configuration_versions").select("agent_id,revision").eq("business_id", access.business.id).order("revision", { ascending: false }).limit(100);
  if (history.error) throw new Error("Versionet e konfigurimit nuk u ngarkuan.");
  async function configure(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar." };
    const current = await requireBusinessAccess(session.id, slug);
    if (!current) return { error: "Nuk ke qasje në këtë biznes." };
    try {
      const mode = String(formData.get("mode") ?? "");
      const input = { id: String(formData.get("id") ?? ""), mode,
        ...(mode === "draft" ? { instructions: String(formData.get("instructions") ?? ""), communication: {
          version: 1, ...Object.fromEntries(["language", "tone", "length", "questions", "emoji"].map(key => [key, String(formData.get(key) ?? "")])) } } : {}),
        ...(mode === "restore" ? { revision: Number(formData.get("revision")) } : {}),
      };
      const proposal = await prepareCommunicationConfiguration(current.business.id, input);
      if (proposal.before.updated_at !== formData.get("updated_at")) return { error: "Konfigurimi ndryshoi. Rifresko përpara ruajtjes." };
      const result = await saveCommunicationConfiguration(current.business.id, session.id, proposal);
      revalidatePath(`/b/${slug}`, "layout");
      return { success: result.message };
    } catch (error) { return { error: (error as Error).message }; }
  }
  const canCreate = (agents?.length ?? 0) < limit.maxAgents;

  async function save(formData: FormData) {
    "use server";
    const session = await getSessionUser();
    if (!session) return { error: "Sesioni ka skaduar. Hyr përsëri." };
    const acc = await requireBusinessAccess(session.id, slug);
    if (!acc) return { error: "Nuk ke qasje në këtë biznes." };
    try {
      const id = String(formData.get("id") ?? "");
      const proposal = await prepareManagedAgent(acc.business.id, { ...(id ? { id } : {}),
        name: String(formData.get("name") ?? ""), instructions: String(formData.get("instructions") ?? ""), is_active: formData.get("is_active") === "on" });
      if (id && proposal.before?.updated_at !== formData.get("updated_at")) return { error: "Agjenti ndryshoi. Rifresko faqen përpara ruajtjes." };
      await saveManagedAgent(acc.business.id, session.id, proposal);
    } catch (error) { return { error: (error as Error).message }; }
    revalidatePath(`/b/${slug}`, "layout");
  }

  const agentForm = (a?: {
    id: string;
    name: string;
    instructions: string;
    is_active: boolean;
    updated_at: string;
  }) => (
    <ActionForm action={save} className={a ? "grid gap-4 agent-identity-form" : "grid gap-5"}>
      {a && <input type="hidden" name="id" value={a.id} />}
      {a && <input type="hidden" name="updated_at" value={a.updated_at} />}
      <label className="form-label">
        Emri i agjentit
        <input
          name="name"
          defaultValue={a?.name || "Agjent shitjesh"}
          className="field"
          required
        />
      </label>
      {a ? <input type="hidden" name="instructions" value={a.instructions} /> : <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="form-label mb-0">
            Udhëzimet për Agjentin (Prompt)
          </span>
        </div>
        <textarea
          name="instructions"
          defaultValue={
            "Përgjigju në gjuhën e klientit. Përdor çmimet nga katalogu dhe mos shpik informacion. Kërko vetëm të dhënat për hapin aktual të workflow-t."
          }
          rows={12}
          className="field"
          required
        />
        <p className="muted-copy">
          Shkruaji udhëzimet këtu ose kërkoja Agjentit t’i përditësojë me tekst ose audio.
        </p>
      </div>}
      <label className="toggle-label">
        <span>
          Agjenti aktiv
          <small>Vetëm një agjent mund të jetë aktiv për biznes.</small>
        </span>
        <input
          className="switch-input"
          type="checkbox"
          name="is_active"
          defaultChecked={a?.is_active ?? false}
        />
      </label>
      <button className="btn btn-primary w-fit" type="submit">
        {a ? "Ruaj ndryshimet" : "Krijo agjentin"}
      </button>
    </ActionForm>
  );
  const active = (agents ?? []).find((agent) => agent.is_active) ?? null;
  return (
    <>
      <PageHeading
        title="Udhëzimet"
        description={`Si flet Agjenti me klientët e ${access.business.name} në Instagram dhe WhatsApp. Faktet (çmimet, oferta, dërgesa) i lexon nga Njohuritë.`}
      >
        <div className="agent-heading-actions">
          <Link href={`/b/${slug}/agents/memory`} className="btn btn-ghost">Memoria</Link>
          <Link href={`/b/${slug}/agents/test`} className="btn btn-primary">Provo Agjentin →</Link>
        </div>
      </PageHeading>
      <div className="agent-page">
        <div className="agent-page-main">
          {(agents ?? []).map((a) => (
            <CommunicationEditor key={a.id} agent={a as CommunicationEditorAgent} slug={slug} versions={(history.data ?? []).filter(v => v.agent_id === a.id).map(v => v.revision)} action={configure} />
          ))}
          {canCreate && (
            <details className="panel section-pad agent-create" open={!agents?.length}>
              <summary>+ Krijo një agjent të ri</summary>
              <div className="mt-5">{agentForm()}</div>
            </details>
          )}
        </div>
        <aside className="agent-page-side">
          <section className="panel section-pad agent-status" aria-labelledby="agent-status-title">
            <h2 id="agent-status-title">Gjendja</h2>
            <dl>
              <div><dt>Agjenti</dt><dd><span className={`status-badge ${active ? "status-connected" : "status-paused"}`}>{active ? `${active.name} · aktiv` : "Asnjë agjent aktiv"}</span></dd></div>
              <div><dt>Përgjigjet automatike</dt><dd><span className={`status-badge ${access.business.auto_reply ? "status-connected" : "status-paused"}`}>{access.business.auto_reply ? "Të ndezura" : "Të fikura"}</span></dd></div>
            </dl>
            <p className="muted-copy">Agjenti u përgjigjet vetë klientëve vetëm kur është aktiv dhe përgjigjet automatike janë të ndezura.</p>
            <Link href={`/b/${slug}/settings/business`} className="soft-link">Përgjigjet automatike te Cilësimet →</Link>
            {(agents ?? []).map((a) => (
              <details key={a.id} className="agent-identity">
                <summary>Emri dhe aktivizimi{agents!.length > 1 ? ` · ${a.name}` : ""}</summary>
                {agentForm(a)}
              </details>
            ))}
            {!canCreate && limit.allowMultiple && <p className="muted-copy">Ky biznes ka arritur limitin e dy agjentëve.</p>}
          </section>
          {!!agents?.length && <InstructionFacts slug={slug} />}
        </aside>
      </div>
    </>
  );
}
