"use client";
import { useState } from "react";
import type { LinearCard } from "@/lib/business-assistant/linear-service";
import { simulateProductWorkflow } from "@/lib/workflows/linear-test-actions";
import "./linear-workflow-card.css";
export function LinearWorkflowCard({ data, slug, pending, onRequest }: {
    data: LinearCard;
    slug: string;
    pending: boolean;
    onRequest: (message: string) => void;
}) {
    const [text, setText] = useState("");
    const [token, setToken] = useState<string>();
    const [reply, setReply] = useState("");
    const [busy, setBusy] = useState(false);
    const [photo, setPhoto] = useState(false);
    async function test() {
        if (!data.productId || busy)
            return;
        setBusy(true);
        try {
            const result = await simulateProductWorkflow(slug, data.productId, text, token, photo);
            setReply(result.error ?? result.reply ?? "");
            if (result.session) {
                setToken(result.session);
                setText("");
                setPhoto(false);
            }
        }
        catch {
            setReply("Prova nuk përfundoi. Provo përsëri.");
        }
        finally {
            setBusy(false);
        }
    }
    const products = data.productId ? data.products.filter(p => p.id === data.productId) : data.products;
    return (<section className="assistant-preview linear-workflow-card" aria-label="Workflow-t e produkteve">
      <h3>Workflow-t e produkteve</h3>
      {data.partial && <p className="muted-copy">Lista është e pjesshme. Kërko produktin me emër për ta gjetur.</p>}
      {products.map(product => {
            const active = data.versions.find(v => v.workflow_id === product.workflow_id);
            return (<div className="linear-workflow-product" key={product.id}>
            <strong>{product.name}</strong>
            <p>Aktiv: {active?.name ?? (product.workflow_id ? "Kërko hollësitë e workflow-t" : "Pa workflow")}</p>
            {active && <ol>{active.steps.map(step => <li key={step.key}>{step.label ?? step.key}</li>)}</ol>}
            <button className="assistant-secondary" onClick={() => onRequest(`Më trego dhe ndihmo të ndryshoj workflow-n e produktit “${product.name}” (${product.id}).`)}>Ndrysho me AI</button>
          </div>);
        })}
      {data.draft && (<div className="linear-workflow-draft">
          <h4>Draft: {data.draft.definition.name}</h4>
          <ol>{data.draft.definition.steps.map(step => <li key={step.key}>{step.label ?? step.key}</li>)}</ol>
          <button className="assistant-primary" disabled={pending || data.draft.published_revision === data.draft.revision} onClick={() => onRequest(`Publiko draftin e workflow-t për produktin ${data.productId}.`)}>Publiko draftin</button>
          <div className="linear-workflow-test">
            <label>Provoje si klient<input className="field" value={text} onChange={e => setText(e.target.value)} maxLength={2000} placeholder={token ? "Përgjigjja e klientit" : "Nis provën për të parë pyetjen e parë"} disabled={!token || busy}/></label>
            <label className="linear-workflow-photo"><input type="checkbox" checked={photo} disabled={!token || busy} onChange={e => setPhoto(e.target.checked)}/> Foto prove</label>
            <div className="linear-workflow-actions">
              <button className="assistant-secondary" disabled={busy || pending || (Boolean(token) && !text.trim() && !photo)} onClick={() => void test()}>{busy ? "Po provohet…" : token ? "Dërgo" : "Nis provën"}</button>
              <button className="assistant-secondary" disabled={busy} onClick={() => { setToken(undefined); setReply(""); setText(""); setPhoto(false); }}>Rifillo</button>
            </div>
            {reply && <p role="status" className="linear-workflow-reply">{reply}</p>}
            <small>Prova nuk dërgon mesazhe dhe nuk ndryshon të dhënat e klientëve.</small>
          </div>
        </div>)}
    </section>);
}
