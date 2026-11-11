import Link from "next/link";
import { ActionForm, type ActionResult } from "@/components/dashboard/action-form";
import type { CommunicationPolicy } from "@/lib/agents/communication-policy";

export type CommunicationEditorAgent = {
  id: string; name: string; instructions: string; is_active: boolean; updated_at: string;
  communication: CommunicationPolicy; configuration_revision: number;
  configuration_draft: { instructions: string; communication: CommunicationPolicy; baseRevision: number } | null;
};

/** The agent's instructions first, then how it talks; saved as a draft that is
 * tested and published on purpose, with earlier versions one step away. */
export function CommunicationEditor({ agent, slug, versions, action }: {
  agent: CommunicationEditorAgent; slug: string; versions: number[];
  action: (data: FormData) => Promise<ActionResult | void>;
}) {
  const draft = agent.configuration_draft;
  const policy = draft?.communication ?? agent.communication;
  const identity = <><input type="hidden" name="id" value={agent.id} /><input type="hidden" name="updated_at" value={agent.updated_at} /></>;
  const stale = Boolean(draft && draft.baseRevision !== agent.configuration_revision);
  const older = versions.filter(revision => revision !== agent.configuration_revision);
  return <section className="panel section-pad agent-editor" aria-label={`Udhëzimet e ${agent.name}`}>
    <header className="agent-editor-head">
      <div>
        <h2>{agent.name}</h2>
        <p className="muted-copy">Versioni {agent.configuration_revision} {agent.is_active ? "në përdorim" : "· agjenti joaktiv"}{draft ? " · ke një draft të papublikuar" : ""}</p>
      </div>
    </header>
    {draft && <div className="agent-callout" role="status">
      <p><strong>Draft i papublikuar.</strong> Bisedat live përdorin ende versionin {agent.configuration_revision}. Provoje dhe publikoje kur të jetë gati.</p>
      {stale && <p role="alert">Versioni i publikuar ka ndryshuar që nga ky draft. Rishikoje dhe ruaje sërish përpara publikimit.</p>}
      <div className="agent-callout-actions">
        {!stale && <Link className="btn btn-ghost" href={`/b/${slug}/agents/test?draft=${agent.id}`}>Provo draftin</Link>}
        <ActionForm action={action}>{identity}<input type="hidden" name="mode" value="publish" /><button className="btn btn-primary" type="submit" disabled={stale}>Publiko draftin</button></ActionForm>
        <ActionForm action={action}>{identity}<input type="hidden" name="mode" value="discard" /><button className="btn btn-ghost" type="submit">Hiq draftin</button></ActionForm>
      </div>
    </div>}
    <ActionForm action={action} className="agent-editor-form" key={`${agent.id}:${agent.updated_at}`}>
      {identity}<input type="hidden" name="mode" value="draft" />
      <label className="form-label agent-instructions">
        <span className="agent-editor-label">Udhëzimet</span>
        <small>Si të sillet Agjenti: çfarë të thotë, çfarë të pyesë, kur t&apos;ia kalojë stafit. Faktet e biznesit mbahen te Njohuritë.</small>
        <textarea className="field" name="instructions" rows={14} maxLength={8000} required defaultValue={draft?.instructions ?? agent.instructions} />
      </label>
      <fieldset className="agent-style">
        <legend>Mënyra e komunikimit</legend>
        <div className="agent-style-grid">
          <label className="form-label">Gjuha<select name="language" className="field" defaultValue={policy.language}><option value="customer">Gjuha e klientit</option><option value="sq">Shqip</option><option value="en">Anglisht</option></select></label>
          <label className="form-label">Toni<select name="tone" className="field" defaultValue={policy.tone}><option value="warm">I ngrohtë</option><option value="neutral">Neutral</option><option value="formal">Formal</option></select></label>
          <label className="form-label">Gjatësia<select name="length" className="field" defaultValue={policy.length}><option value="concise">Përgjigje të shkurtra</option><option value="balanced">Shpjegim sipas nevojës</option></select></label>
          <label className="form-label">Pyetjet njohëse<select name="questions" className="field" defaultValue={policy.questions}><option value="when_needed">Një pyetje kur ndihmon bisedën</option><option value="on_request">Pa pyetje njohëse shtesë</option></select></label>
          <label className="form-label">Emoji<select name="emoji" className="field" defaultValue={policy.emoji}><option value="light">Me masë</option><option value="none">Pa emoji</option></select></label>
        </div>
      </fieldset>
      <div className="agent-editor-footer">
        <button className="btn btn-primary" type="submit">Ruaj si draft</button>
        <p className="muted-copy">Ndryshimet ruhen si draft dhe nuk prekin bisedat live derisa t&apos;i publikosh. Mund t&apos;ia kërkosh edhe Asistentit.</p>
      </div>
    </ActionForm>
    {older.length > 0 && <details className="agent-versions">
      <summary>Versionet e mëparshme ({older.length})</summary>
      <ActionForm action={action} className="agent-versions-form">{identity}<input type="hidden" name="mode" value="restore" />
        <label className="form-label">Versioni<select className="field" name="revision">{older.map(revision => <option key={revision} value={revision}>Versioni {revision}</option>)}</select></label>
        <button className="btn btn-ghost" type="submit">Rikthe si draft</button>
      </ActionForm>
    </details>}
  </section>;
}
