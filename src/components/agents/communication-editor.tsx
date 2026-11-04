import Link from "next/link";
import { ActionForm, type ActionResult } from "@/components/dashboard/action-form";
import type { CommunicationPolicy } from "@/lib/agents/communication-policy";

export type CommunicationEditorAgent = {
  id: string; name: string; instructions: string; is_active: boolean; updated_at: string;
  communication: CommunicationPolicy; configuration_revision: number;
  configuration_draft: { instructions: string; communication: CommunicationPolicy; baseRevision: number } | null;
};
export function CommunicationEditor({ agent, slug, versions, action }: {
  agent: CommunicationEditorAgent; slug: string; versions: number[];
  action: (data: FormData) => Promise<ActionResult | void>;
}) {
  const draft = agent.configuration_draft;
  const policy = draft?.communication ?? agent.communication;
  const identity = <><input type="hidden" name="id" value={agent.id} /><input type="hidden" name="updated_at" value={agent.updated_at} /></>;
  const stale = Boolean(draft && draft.baseRevision !== agent.configuration_revision);
  return <section className="panel section-pad grid gap-5" aria-label={`Komunikimi i ${agent.name}`}>
    <div className="section-title"><div><h2>{agent.name} · Komunikimi</h2>
      <p className="muted-copy">Versioni {agent.configuration_revision} · {agent.is_active ? "Në përdorim" : "Agjenti joaktiv"}</p></div>
      <Link className="btn btn-ghost" href={`/b/${slug}/agents/test`}>Provo versionin e publikuar</Link></div>
    <p className="muted-copy">Përcakto mënyrën e bisedës. Produktet, çmimet dhe politikat merren nga të dhënat e biznesit; lejet dhe konfirmimet mbeten të detyrueshme.</p>
    {draft && <p role="status">Ke një draft të papublikuar. Bisedat live përdorin ende versionin {agent.configuration_revision}.</p>}
    {stale && <p role="alert">Konfigurimi i publikuar ka ndryshuar që nga ky draft. Rishiko ndryshimet dhe ruaje draftin përsëri përpara publikimit.</p>}
    <ActionForm action={action} className="grid gap-4" key={`${agent.id}:${agent.updated_at}`}>
      {identity}<input type="hidden" name="mode" value="draft" />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="form-label">Gjuha<select name="language" className="field" defaultValue={policy.language}><option value="customer">Gjuha e klientit</option><option value="sq">Shqip</option><option value="en">Anglisht</option></select></label>
        <label className="form-label">Toni<select name="tone" className="field" defaultValue={policy.tone}><option value="warm">I ngrohtë</option><option value="neutral">Neutral</option><option value="formal">Formal</option></select></label>
        <label className="form-label">Gjatësia<select name="length" className="field" defaultValue={policy.length}><option value="concise">Përgjigje të shkurtra</option><option value="balanced">Shpjegim sipas nevojës</option></select></label>
        <label className="form-label">Pyetjet njohëse<select name="questions" className="field" defaultValue={policy.questions}><option value="when_needed">Një pyetje kur ndihmon bisedën</option><option value="on_request">Pa pyetje njohëse shtesë</option></select></label>
        <label className="form-label">Emoji<select name="emoji" className="field" defaultValue={policy.emoji}><option value="light">Me masë</option><option value="none">Pa emoji</option></select></label>
      </div>
      <label className="form-label">Udhëzime për komunikimin<textarea className="field" name="instructions" rows={7} maxLength={8000} required defaultValue={draft?.instructions ?? agent.instructions} /></label>
      <p className="muted-copy">Mund t’ia kërkosh edhe asistentit. Ndryshimet ruhen si draft; publikimi bëhet veçmas.</p>
      <button className="btn btn-primary w-fit" type="submit">Ruaj draftin</button>
    </ActionForm>
    {draft && <div className="flex flex-wrap gap-3">
      {!stale && <Link className="btn btn-ghost" href={`/b/${slug}/agents/test?draft=${agent.id}`}>Provo draftin e ruajtur</Link>}
      <ActionForm action={action}>{identity}<input type="hidden" name="mode" value="publish" /><button className="btn btn-primary" type="submit" disabled={stale}>Publiko draftin e ruajtur</button></ActionForm>
      <ActionForm action={action}>{identity}<input type="hidden" name="mode" value="discard" /><button className="btn btn-ghost" type="submit">Hiq draftin</button></ActionForm>
    </div>}
    {versions.some(revision => revision !== agent.configuration_revision) && <details><summary>Versionet e mëparshme</summary>
      <ActionForm action={action} className="grid gap-3 mt-3">{identity}<input type="hidden" name="mode" value="restore" />
        <label className="form-label">Versioni<select className="field" name="revision">{versions.filter(revision => revision !== agent.configuration_revision).map(revision => <option key={revision} value={revision}>Versioni {revision}</option>)}</select></label>
        <button className="btn btn-ghost w-fit" type="submit">Rikthe si draft</button>
      </ActionForm></details>}
  </section>;
}
