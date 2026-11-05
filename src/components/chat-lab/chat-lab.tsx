"use client";
import { useEffect, useState } from "react";
import { loadLabSetup, loadLabDrafts, searchLabBusinesses } from "@/lib/chat-lab/actions";
import type { LabBusiness, LabSetup } from "@/lib/chat-lab/model";
import { AgentTestChat } from "@/components/agents/test-chat";
import { ConversationInspector } from "./conversation-inspector";
import "./chat-lab.css";

export function ChatLab({ userId, initialBusiness, initialDraft }: { userId: string; initialBusiness?: string; initialDraft?: string }) {
  const [query, setQuery] = useState("");
  const [businesses, setBusinesses] = useState<LabBusiness[]>([]);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [businessId, setBusinessId] = useState(initialBusiness ?? "");
  const [setup, setSetup] = useState<LabSetup | null>(null);
  const [drafts, setDrafts] = useState<{ id: string; name: string }[]>([]);
  const [configurationDraft, setConfigurationDraft] = useState(initialDraft ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const result = await searchLabBusinesses(query);
        if (!stale) { setBusinesses(result.businesses); setSearchError(result.error ?? ""); }
      } catch { if (!stale) setSearchError("Bizneset nuk u ngarkuan."); }
      finally { if (!stale) setSearching(false); }
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [query]);
  useEffect(() => {
    if (!businessId) return;
    let stale = false;
    setLoading(true); setSetup(null); setError(""); setDrafts([]);
    Promise.all([loadLabSetup(businessId), loadLabDrafts(businessId)]).then(([result, configurations]) => {
      if (stale) return;
      if ("error" in result) setError(result.error);
      else { setSetup(result.setup); setDrafts(configurations.drafts); setError(configurations.error ?? ""); }
    }).catch(() => { if (!stale) setError("Konfigurimi nuk u ngarkua. Zgjidh sërish biznesin."); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [businessId]);
  function changeBusiness(id: string) {
    if (id === businessId) return;
    if (setup && !window.confirm("Ndrysho biznesin? Historiku ruhet në këtë shfletues; teksti i padërguar nuk ruhet.")) return;
    setConfigurationDraft(""); setBusinessId(id);
  }
  const validDraft = !configurationDraft || drafts.some(draft => draft.id === configurationDraft);
  return <div className="chat-lab">
    <header className="lab-heading"><div><div className="lab-eyebrow">ADMIN WORKSPACE</div><h1>ChatLab</h1><p>Biseda, mjetet e testimit dhe gjurmët e të njëjtave mesazhe.</p></div></header>
    <div className="lab-unified-layout">
      <aside className="lab-setup panel">
        <div className="lab-panel-heading"><h2>Test Setup</h2></div>
        <label htmlFor="lab-business-search">Biznesi</label><input id="lab-business-search" type="search" value={query} maxLength={100} placeholder="Kërko biznesin…" onChange={event => setQuery(event.target.value)} />
        {searchError && <p role="alert">{searchError}</p>}
        <div className="lab-businesses" aria-busy={searching}>
          {searching ? <p>Po kërkojmë…</p> : businesses.map(business => <button key={business.id} aria-pressed={businessId === business.id} onClick={() => changeBusiness(business.id)}><span><strong>{business.name}</strong><small>{business.slug}</small></span></button>)}
          {!searching && !businesses.length && <p>Nuk u gjetën biznese.</p>}
        </div>
        {loading && <p role="status">Po ngarkojmë konfigurimin…</p>}
        {error && <p role="alert">{error}</p>}
        {setup && <>
          <h3>{setup.name}</h3>
          <dl className="lab-counts"><div><dt>Produkte aktive</dt><dd>{setup.products}</dd></div><div><dt>Shërbime aktive</dt><dd>{setup.services}</dd></div><div><dt>Workflow aktiv</dt><dd>{setup.workflows}</dd></div></dl>
          {setup.workflowName && <p>{setup.workflowName}</p>}
          <label htmlFor="lab-configuration">Konfigurimi</label>
          <select id="lab-configuration" value={configurationDraft} onChange={event => {
            if (window.confirm("Ndrysho konfigurimin? Bisedat e tij kanë historik të veçantë; teksti i padërguar nuk ruhet.")) setConfigurationDraft(event.target.value);
          }}><option value="">Versioni i publikuar</option>{drafts.map(draft => <option key={draft.id} value={draft.id}>Draft · {draft.name}</option>)}</select>
          {configurationDraft && <p className="lab-muted">Drafti nuk ndryshon versionin e publikuar dhe nuk lejon Real chat.</p>}
          <div className="lab-channels"><h3>Integrimet</h3>{setup.channels.length ? setup.channels.map((channel, index) => <p key={index}>Instagram {channel.username} · {channel.status}</p>) : <p>Pa lidhje Instagram. Prova funksionon pa të.</p>}</div>
        </>}
      </aside>
      {setup && !loading ? validDraft ? <AgentTestChat key={`${setup.id}:${configurationDraft}`} advanced slug={setup.slug} businessName={setup.name} userId={userId} configurationDraft={configurationDraft || undefined}
        renderInspector={(entry, chat) => <ConversationInspector entry={entry} chat={chat} />} /> : <p role="alert">Drafti nuk është i disponueshëm. Zgjidh versionin e publikuar ose një draft tjetër.</p>
        : <div className="lab-empty"><h2>Zgjidh biznesin për të filluar</h2><p>Skedarët, audioja, historiku, trajnimi dhe inspektori përdorin të njëjtën bisedë.</p></div>}
    </div>
  </div>;
}
