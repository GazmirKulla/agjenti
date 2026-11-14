"use client";
import { useEffect, useState } from "react";

type Result = { message: string; current: { reply: string }; proposed: { reply: string } };
type Verdict = "current" | "proposed" | "own";

/** Step 5: real customer messages answered by the agent as it is now and as it would be
 * after this training, side by side. Isolated test turns: nothing is saved or sent. */
export function TrainingTest({ endpoint, sessionId, onFeedback }: { endpoint: string; sessionId: string; onFeedback?: () => void }) {
  const [messages, setMessages] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [own, setOwn] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${endpoint}&session=${encodeURIComponent(sessionId)}&tests=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { messages: [] })).then((d) => setMessages(d.messages ?? [])).catch(() => null);
  }, [endpoint, sessionId]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Prova nuk u krye.");
    return data;
  }
  async function run(message: string) {
    setRunning(message); setError("");
    try { const data = await post({ action: "compare", id: sessionId, message }); setResults((r) => ({ ...r, [message]: data })); }
    catch (e) { setError(e instanceof Error ? e.message : "Prova nuk u krye."); }
    finally { setRunning(null); }
  }
  async function judge(message: string, choice: Verdict) {
    setError("");
    try {
      await post({ action: "test_feedback", id: sessionId, message, choice, ...(choice === "own" ? { preferred: own[message] } : {}) });
      setVerdicts((v) => ({ ...v, [message]: choice })); setWriting(null);
      if (choice === "own") onFeedback?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Nuk u ruajt."); }
  }

  const list = [...messages, ...Object.keys(results).filter((m) => !messages.includes(m))];
  return (
    <section className="training-test" aria-labelledby="training-test-title">
      <h3 id="training-test-title">5. Provo Agjentin para se ta ndryshosh</h3>
      <p className="training-note">Mesazhe të vërteta nga klientët e tu. Agjenti përgjigjet dy herë: si është tani dhe si do të jetë me këtë trajnim. Asgjë nuk i dërgohet askujt dhe asgjë nuk ruhet.</p>
      <form className="training-test-custom" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) { void run(custom.trim()); setCustom(""); } }}>
        <input className="field" value={custom} maxLength={2000} placeholder="Ose shkruaj një mesazh klienti…" onChange={(e) => setCustom(e.target.value)} />
        <button type="submit" className="btn btn-ghost" disabled={!custom.trim() || !!running}>Provo</button>
      </form>
      <ul className="training-test-list">
        {list.map((message) => {
          const result = results[message];
          return (
            <li key={message}>
              <div className="training-test-head">
                <p>«{message}»</p>
                {!result && <button type="button" className="btn btn-ghost" disabled={!!running} onClick={() => void run(message)}>{running === message ? "Po përgjigjet…" : "Provo"}</button>}
              </div>
              {result && (
                <>
                  <div className="training-test-compare">
                    <div className={verdicts[message] === "current" ? "is-chosen" : ""}><span>Agjenti tani</span><p>{result.current.reply}</p></div>
                    <div className={`is-proposed ${verdicts[message] === "proposed" ? "is-chosen" : ""}`}><span>Me trajnimin</span><p>{result.proposed.reply}</p></div>
                  </div>
                  {verdicts[message] ? (
                    <p className="training-done">{verdicts[message] === "own" ? "Përgjigjja jote u shtua si shembull i miratuar." : "Faleminderit, u shënua."}</p>
                  ) : writing === message ? (
                    <div className="training-edit">
                      <textarea className="field" rows={3} maxLength={3000} value={own[message] ?? ""} placeholder="Si do të përgjigjeshe ti?" onChange={(e) => setOwn((o) => ({ ...o, [message]: e.target.value }))} />
                      <div className="training-actions">
                        <button type="button" className="btn btn-primary" disabled={!own[message]?.trim()} onClick={() => void judge(message, "own")}>Ruaje si shembull</button>
                        <button type="button" className="btn btn-ghost" onClick={() => setWriting(null)}>Anulo</button>
                      </div>
                    </div>
                  ) : (
                    <div className="training-actions">
                      <button type="button" className="btn btn-primary" onClick={() => void judge(message, "proposed")}>Më mirë me trajnimin</button>
                      <button type="button" className="btn btn-ghost" onClick={() => void judge(message, "current")}>Më mirë si tani</button>
                      <button type="button" className="btn btn-ghost" onClick={() => setWriting(message)}>Shkruaj përgjigjen time</button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="training-error" role="alert">{error}</p>}
    </section>
  );
}
