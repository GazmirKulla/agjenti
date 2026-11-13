"use client";
import { useEffect, useState } from "react";
import { loadLabSetup, loadLabDrafts, searchLabBusinesses } from "@/lib/chat-lab/actions";
import type { LabBusiness, LabSetup } from "@/lib/chat-lab/model";
import { AgentTestChat } from "@/components/agents/test-chat";
import { ConversationInspector } from "./conversation-inspector";
import { Icon } from "@/components/dashboard/icon";
import "./chat-lab.css";

export function ChatLab({ userId, initialBusiness, initialDraft }: { userId: string; initialBusiness?: string; initialDraft?: string }) {
  const [setupOpen, setSetupOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [businesses, setBusinesses] = useState<LabBusiness[]>([]);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [businessId, setBusinessId] = useState(initialBusiness ?? "");
  const [setup, setSetup] = useState<LabSetup | null>(null);
  const [drafts, setDrafts] = useState<{ id: string; name: string }[]>([]);
  const [configurationDraft, setConfigurationDraft] = useState(initialDraft ?? "");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
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
  }, [businessId, reload]);
  function changeBusiness(id: string) {
    if (id === businessId) return;
    if (setup && !window.confirm("Ndrysho biznesin? Historiku ruhet në këtë shfletues; teksti i padërguar nuk ruhet.")) return;
    setConfigurationDraft(""); setBusinessId(id);
  }
  const validDraft = !configurationDraft || drafts.some(draft => draft.id === configurationDraft);
  return <div className="chat-lab">
    <header className="lab-heading"><div><div className="lab-eyebrow">ADMIN WORKSPACE</div><h1>ChatLab</h1><p>Biseda, mjetet e testimit dhe gjurmët e të njëjtave mesazhe.</p></div></header>
    <div className="lab-unified-layout">
      <aside className={`lab-setup panel ${setupOpen ? "" : "is-collapsed"}`}>
        <div className="lab-panel-heading"><div><h2>Prova</h2>{!setupOpen && <p className="lab-muted">{setup?.name ?? "Zgjidh biznesin"}</p>}</div><button type="button" className="lab-setup-toggle" aria-label="Shfaq ose fshih panelin e provës" aria-expanded={setupOpen} onClick={() => setSetupOpen(open => !open)}>{setupOpen ? "−" : "+"}</button></div>
        <div className="lab-search"><Icon name="search" size={15} /><input id="lab-business-search" type="search" aria-label="Kërko biznesin" value={query} maxLength={100} placeholder="Kërko biznesin…" onChange={event => setQuery(event.target.value)} /></div>
        {searchError && <p className="lab-muted" role="alert">{searchError}</p>}
        <div className="lab-businesses" aria-busy={searching}>
          {searching ? <p className="lab-muted">Po kërkojmë…</p> : businesses.map(business => <button key={business.id} type="button" aria-pressed={businessId === business.id} title={business.name} onClick={() => changeBusiness(business.id)}>
            <span className="lab-avatar" aria-hidden="true">{business.name.trim().charAt(0).toUpperCase() || "?"}</span><strong>{business.name}</strong></button>)}
          {!searching && !businesses.length && <p className="lab-muted">Asnjë biznes.</p>}
        </div>
        {loading && <p className="lab-muted" role="status">Po ngarkohet…</p>}
        {error && <p role="alert" className="lab-muted">{error} <button type="button" className="btn btn-ghost" onClick={() => setReload(value => value + 1)}>Provo përsëri</button></p>}
        {setup && <section className="lab-selected" aria-label={setup.name}>
          <dl className="lab-counts"><div><dd>{setup.products}</dd><dt>Produkte</dt></div><div><dd>{setup.services}</dd><dt>Shërbime</dt></div><div><dd>{setup.workflows}</dd><dt>Workflow</dt></div></dl>
          <label htmlFor="lab-configuration">Versioni</label>
          <select id="lab-configuration" value={configurationDraft} onChange={event => {
            if (window.confirm("Ndrysho versionin? Bisedat e tij kanë historik të veçantë; teksti i padërguar nuk ruhet.")) setConfigurationDraft(event.target.value);
          }}><option value="">I publikuar</option>{drafts.map(draft => <option key={draft.id} value={draft.id}>Draft · {draft.name}</option>)}</select>
          {configurationDraft && <p className="lab-muted">Drafti nuk lejon Real chat.</p>}
          <ul className="lab-channels">{setup.channels.length ? setup.channels.map((channel, index) => <li key={index}><Icon name="instagram" size={14} /> {channel.username ? `@${channel.username}` : "Instagram"} <span className={`lab-dot ${channel.status === "connected" ? "is-on" : ""}`} title={channel.status} /></li>)
            : <li><Icon name="instagram" size={14} /> Pa Instagram</li>}</ul>
        </section>}
      </aside>
      {setup && !loading ? validDraft ? <AgentTestChat key={`${setup.id}:${configurationDraft}`} advanced slug={setup.slug} businessName={setup.name} userId={userId} configurationDraft={configurationDraft || undefined}
        renderInspector={(entry, chat) => <ConversationInspector entry={entry} chat={chat} />} /> : <p role="alert">Drafti nuk është i disponueshëm. Zgjidh versionin e publikuar ose një draft tjetër.</p>
        : <div className="lab-empty"><h2>Zgjidh një biznes</h2><p>Biseda dhe inspektori shfaqen këtu.</p></div>}
    </div>
  </div>;
}
