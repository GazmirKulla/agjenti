import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ActionForm, type ActionResult } from "@/components/dashboard/action-form";
import type { CommunicationPolicy } from "@/lib/agents/communication-policy";

export type CommunicationEditorAgent = {
  id: string; name: string; instructions: string; is_active: boolean; updated_at: string;
  communication: CommunicationPolicy; configuration_revision: number;
  configuration_draft: { instructions: string; communication: CommunicationPolicy; baseRevision: number } | null;
};

/** The agent's instructions first, then how it talks. Ruaj applies them to new replies right away; every
 * save becomes a version that can be brought back. A draft saved before that waits for Zbato / Hidh poshtë. */
export function CommunicationEditor({ agent, slug, action }: {
  agent: CommunicationEditorAgent; slug: string;
  action: (data: FormData) => Promise<ActionResult | void>;
}) {
  const draft = agent.configuration_draft;
  const policy = agent.communication;
  const identity = <><input type="hidden" name="id" value={agent.id} /><input type="hidden" name="updated_at" value={agent.updated_at} /><input type="hidden" name="request_id" value={randomUUID()} /></>;
  const stale = Boolean(draft && draft.baseRevision !== agent.configuration_revision);
  return <section className="panel section-pad agent-editor" aria-label={`Udhëzimet e ${agent.name}`}>
    <header className="agent-editor-head">
      <div>
        <h2>{agent.name}</h2>
        <p className="muted-copy">{agent.is_active ? "Në përdorim" : "Agjenti joaktiv, nuk u përgjigjet klientëve"}</p>
      </div>
    </header>
    {draft && <div className="agent-callout" role="status">
      <p><strong>Ndryshime të ruajtura më parë, të pazbatuara.</strong> Agjenti nuk i përdor derisa t&apos;i zbatosh. Zbato i vë në përdorim për përgjigjet e reja si version i ri; Hidh poshtë i fshin pa prekur udhëzimet në përdorim.</p>
      {stale && <p role="alert">Udhëzimet u ndryshuan pasi u ruajtën këto ndryshime, prandaj nuk zbatohen dot siç janë. Shikoji më poshtë, kopjo çfarë të duhet te formulari dhe pastaj hidhi poshtë.</p>}
      <details className="agent-draft-preview"><summary>Shiko ndryshimet në pritje</summary><pre>{draft.instructions}</pre></details>
      <div className="agent-callout-actions">
        {!stale && <Link className="btn btn-ghost" href={`/b/${slug}/agents/test?draft=${agent.id}`}>Provo</Link>}
        {!stale && <ActionForm action={action}>{identity}<input type="hidden" name="mode" value="publish" /><button className="btn btn-primary" type="submit">Zbato</button></ActionForm>}
        <ActionForm action={action}>{identity}<input type="hidden" name="mode" value="discard" /><button className="btn btn-ghost" type="submit">Hidh poshtë</button></ActionForm>
      </div>
    </div>}
    <ActionForm action={action} className="agent-editor-form" key={`${agent.id}:${agent.updated_at}`}>
      {identity}<input type="hidden" name="mode" value="apply" />
      <label className="form-label agent-instructions">
        <span className="agent-editor-label">Udhëzimet</span>
        <small>Si të sillet Agjenti: çfarë të thotë, çfarë të pyesë, kur t&apos;ia kalojë stafit. Faktet e biznesit mbahen te Njohuritë.</small>
        <textarea className="field" name="instructions" rows={14} maxLength={8000} required defaultValue={agent.instructions} />
      </label>
      <fieldset className="agent-style">
        <legend>Mënyra e komunikimit</legend>
        <div className="agent-style-grid">
          <label className="form-label">Gjuha<select name="language" className="field" defaultValue={policy.language}><option value="customer">Gjuha e klientit</option><option value="sq">Shqip</option><option value="en">Anglisht</option></select></label>
          <label className="form-label">Toni<select name="tone" className="field" defaultValue={policy.tone}><option value="warm">I ngrohtë</option><option value="neutral">Neutral</option><option value="formal">Formal</option></select></label>
          <label className="form-label">Gjatësia<select name="length" className="field" defaultValue={policy.length}><option value="concise">Përgjigje të shkurtra</option><option value="balanced">Shpjegim sipas nevojës</option></select></label>
          <label className="form-label">Pyetjet njohëse<select name="questions" className="field" defaultValue={policy.questions}><option value="when_needed">Një pyetje kur ndihmon bisedën</option><option value="on_request">Pa pyetje njohëse shtesë</option></select></label>
          <label className="form-label">Emoji<select name="emoji" className="field" defaultValue={policy.emoji}><option value="light">Me masë</option><option value="none">Pa emoji</option></select></label>
          <label className="form-label">Fotot e produkteve<select name="productPhotos" className="field" defaultValue={policy.productPhotos}><option value="send">Dërgo foton kur sugjeron një produkt</option><option value="off">Vetëm emri dhe çmimi</option></select></label>
          <label className="form-label">Informacioni për produktin<select name="productDetails" className="field" defaultValue={policy.productDetails}><option value="helpful">Detajet që e ndihmojnë klientin të vendosë</option><option value="essentials">Vetëm çfarë pyet klienti</option></select></label>
        </div>
        <p className="muted-copy">Kur ia kalon bisedën stafit: {policy.handoffMessage ? `“${policy.handoffMessage}”` : "mesazhi i zakonshëm"}. <Link className="inline-link" href={`/b/${slug}/agents/process`}>Ndrysho te Çfarë bën Agjenti →</Link></p>
      </fieldset>
      <div className="agent-editor-footer">
        <button className="btn btn-primary" type="submit">Ruaj</button>
        <p className="muted-copy">Ruaj i zbaton menjëherë në përgjigjet e reja dhe krijon një version; tri versionet e fundit i gjen te Historiku. Mund t&apos;ia kërkosh edhe Asistentit.</p>
      </div>
    </ActionForm>
  </section>;
}
