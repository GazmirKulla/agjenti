"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icon";
import "./conversation-learning.css";

type Kind = "faq" | "fact" | "gap" | "conflict";
type Suggestion = { kind: Kind; title: string; body: string; evidence: string[]; count: number; existingTitle: string | null };
type State = {
  enabled: boolean; eligible: boolean; count: number; required: number; instagram: boolean;
  limits: { messagesPerConversation: number; maxConversations: number; lookbackDays: number };
};
type Item = Suggestion & { id: number; status: "open" | "saving" | "saved" | "dismissed"; error?: string };

const KIND_LABEL: Record<Kind, string> = {
  faq: "Pyetje e shpeshtë", fact: "Informacion që mungon", gap: "Pa përgjigje", conflict: "Ndryshon nga njohuritë",
};

/** «Mëso nga bisedat»: reads the business's recent conversations and suggests
 * knowledge; each suggestion is saved only when the owner approves it. */
export function ConversationLearning({ slug }: { slug: string }) {
  const endpoint = `/api/conversation-learning?slug=${encodeURIComponent(slug)}`;
  const [state, setState] = useState<State | null>(null);
  const [scanning, setScanning] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(endpoint, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((data) => { if (live) setState(data); }).catch(() => null);
    return () => { live = false; };
  }, [endpoint]);

  if (!state?.enabled) return null;
  const update = (id: number, patch: Partial<Item>) => setItems((list) => list?.map((item) => (item.id === id ? { ...item, ...patch } : item)) ?? null);
  const saved = items?.filter((item) => item.status === "saved").length ?? 0;
  const open = items?.filter((item) => item.status === "open" || item.status === "saving").length ?? 0;

  async function scan() {
    setScanning(true); setError(""); setItems(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "scan" }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Skanimi nuk përfundoi. Provo përsëri pas pak.");
      const list: Suggestion[] = data.suggestions ?? [];
      setItems(list.map((s, id) => ({ ...s, id, status: "open" })));
      const { conversations, messages, fromInstagram } = data.scanned ?? {};
      setSummary(`U lexuan ${conversations} biseda (${messages} mesazhe${fromInstagram ? `, ${fromInstagram} nga historia e Instagram-it` : ""}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Skanimi nuk përfundoi.");
    } finally {
      setScanning(false);
    }
  }

  async function save(item: Item) {
    update(item.id, { status: "saving", error: undefined });
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", suggestion: { kind: item.kind, title: item.title, body: item.body, existingTitle: item.existingTitle } }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Nuk u ruajt. Provo përsëri.");
      update(item.id, { status: "saved" });
    } catch (e) {
      update(item.id, { status: "open", error: e instanceof Error ? e.message : "Nuk u ruajt." });
    }
  }

  function close() {
    setItems(null); setSummary("");
    // The approved entries appear in the list below.
    if (saved) window.location.reload();
  }

  const progress = Math.min(100, Math.round((state.count / state.required) * 100));
  return (
    <section className="conversation-learning" aria-labelledby="conversation-learning-title">
      <div className="conversation-learning-head">
        <span className="knowledge-source-icon"><Icon name="chat" size={20} /></span>
        <div>
          <h2 id="conversation-learning-title">Mëso nga bisedat</h2>
          <p>
            Agjenti lexon bisedat e fundit me klientët{state.instagram ? ", edhe ato të Instagram-it nga përpara lidhjes," : ""} dhe sugjeron pyetjet e shpeshta, informacionin që mungon dhe pyetjet pa përgjigje. Ti vendos çfarë shtohet.
          </p>
        </div>
      </div>

      {!items && (state.eligible ? (
        <div className="conversation-learning-action">
          <button type="button" className="btn btn-primary" disabled={scanning} onClick={() => void scan()}>
            {scanning ? "Po lexoj bisedat…" : "Skano bisedat"}
          </button>
          <p className="conversation-learning-note">
            {scanning ? "Mund të zgjasë deri në një minutë." : `Deri në ${state.limits.maxConversations} bisedat e ${state.limits.lookbackDays} ditëve të fundit, ${state.limits.messagesPerConversation} mesazhet e fundit nga secila. Kontaktet e klientëve hiqen para leximit.`}
          </p>
        </div>
      ) : (
        <div className="conversation-learning-locked">
          <div className="conversation-learning-bar" role="progressbar" aria-valuemin={0} aria-valuemax={state.required} aria-valuenow={state.count} aria-label="Bisedat deri tani">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="conversation-learning-note">
            {state.count} nga {state.required} biseda. Skanimi hapet kur ke të paktën {state.required} biseda me klientë në {state.limits.lookbackDays} ditët e fundit.
          </p>
        </div>
      ))}
      {error && <p className="knowledge-source-error" role="alert">{error}</p>}

      {items && (
        <div className="conversation-learning-results">
          <p className="conversation-learning-note">
            {summary} {items.length ? `${items.length} sugjerime${open ? `, ${open} pa vendosur` : ""}.` : "Nuk u gjet asgjë e re për t'u shtuar: njohuritë i përmbajnë tashmë."}
          </p>
          <ul>
            {items.map((item) => (
              <li key={item.id} className={`conversation-suggestion is-${item.kind} is-${item.status}`}>
                <div className="conversation-suggestion-head">
                  <span className="conversation-suggestion-kind">{KIND_LABEL[item.kind]}</span>
                  <span className="conversation-suggestion-count">{item.count === 1 ? "Në 1 bisedë" : `Në ${item.count} biseda`}</span>
                </div>
                {item.status === "saved" ? (
                  <p className="conversation-suggestion-done"><Icon name="check" size={14} /> {item.kind === "conflict" ? `U përditësua «${item.existingTitle}».` : `U shtua «${item.title}».`}</p>
                ) : item.status === "dismissed" ? (
                  <p className="conversation-suggestion-done">U hodh poshtë: {item.title}</p>
                ) : (
                  <>
                    {item.kind === "conflict" && <p className="conversation-suggestion-hint">Te njohuria «{item.existingTitle}» shkruhet ndryshe nga ç&apos;u përgjigj biznesi në biseda. Ruaje që Agjenti të përdorë tekstin e saktë.</p>}
                    <input className="field" value={item.title} maxLength={500} aria-label="Titulli" disabled={item.status === "saving" || item.kind === "conflict"}
                      onChange={(e) => update(item.id, { title: e.target.value })} />
                    <textarea className="field" rows={3} maxLength={8000} value={item.body} aria-label="Përmbajtja" disabled={item.status === "saving"}
                      placeholder={item.kind === "gap" ? "Klientët e pyesin këtë, por nuk mori përgjigje. Shkruaj përgjigjen që Agjenti duhet të japë." : ""}
                      onChange={(e) => update(item.id, { body: e.target.value })} />
                    {item.evidence.length > 0 && (
                      <details className="conversation-suggestion-evidence">
                        <summary>Nga bisedat</summary>
                        <ul>{item.evidence.map((quote, i) => <li key={i}>«{quote}»</li>)}</ul>
                      </details>
                    )}
                    {item.error && <p className="knowledge-source-error" role="alert">{item.error}</p>}
                    <div className="conversation-suggestion-actions">
                      <button type="button" className="btn btn-primary" disabled={item.status === "saving" || !item.title.trim() || !item.body.trim()} onClick={() => void save(item)}>
                        {item.status === "saving" ? "Duke ruajtur…" : item.kind === "conflict" ? "Përditëso njohurinë" : "Shto te njohuritë"}
                      </button>
                      <button type="button" className="btn btn-ghost" disabled={item.status === "saving"} onClick={() => update(item.id, { status: "dismissed" })}>Hidh poshtë</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="conversation-suggestion-actions">
            <button type="button" className="btn btn-ghost" onClick={close}>{saved ? `Mbyll (${saved} u shtuan)` : "Mbyll"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
