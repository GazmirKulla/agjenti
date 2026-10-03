"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  simulateAgentTurn,
  type TestChatResult,
} from "@/lib/agents/test-chat/actions";
import { Icon } from "@/components/dashboard/icon";
import "./test-chat.css";
type Turn = Exclude<TestChatResult, { error: string }>;
type Bubble = { role: "customer" | "agent"; text: string };
const reasons: Record<string, string> = {
  missing_api_key:
    "OpenAI nuk është konfiguruar. Po shfaqet përgjigjja rezervë e workflow-t.",
  provider_error:
    "Thirrja AI dështoi. Po shfaqet përgjigjja rezervë e workflow-t.",
  empty_reply:
    "AI nuk ktheu tekst. Po shfaqet përgjigjja rezervë e workflow-t.",
};
export function AgentTestChat({
  slug,
  businessName,
  onTurn = simulateAgentTurn,
}: {
  slug: string;
  businessName: string;
  onTurn?: typeof simulateAgentTurn;
}) {
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [photo, setPhoto] = useState(false);
  const [last, setLast] = useState<Turn | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const chatLog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chatLog.current)
      chatLog.current.scrollTop = chatLog.current.scrollHeight;
  }, [messages, pending]);
  function reset() {
    epoch.current++;
    inFlight.current = false;
    setMessages([]);
    setDraft("");
    setPhoto(false);
    setLast(null);
    setError("");
    setPending(null);
  }
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || (!draft.trim() && !photo)) return;
    const run = epoch.current;
    inFlight.current = true;
    setError("");
    const text = draft.trim();
    const display =
      text + (photo ? `${text ? "\n" : ""}[Foto e simuluar]` : "");
    setPending(display);
    try {
      const result = await onTurn({
        slug,
        message: text,
        hasMedia: photo,
        session: last?.session ?? null,
      });
      if (epoch.current !== run) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setMessages((current) => [
        ...current,
        { role: "customer", text: display },
        { role: "agent", text: result.reply },
      ]);
      setLast(result);
      setDraft("");
      setPhoto(false);
    } catch {
      if (epoch.current === run)
        setError(
          "Nuk u lidhëm me shërbimin. Mesazhi mbetet këtu; provo përsëri.",
        );
    } finally {
      if (epoch.current === run) {
        inFlight.current = false;
        setPending(null);
      }
    }
  }
  return (
    <section className="agent-test">
      <div className="agent-test-setup-guide">
        <strong>Provo një porosi nga fillimi deri në fund</strong>
        <p>
          Fillo me emrin e produktit. Në të djathtë sheh hapat e workflow-it:
          çfarë u plotësua dhe çfarë mungon. Të dhënat e klientit mund t’i
          dërgosh edhe në një mesazh (emër, tel, qytet, adresë).
        </p>
        {last?.setupTestPassed && (
          <p role="status">
            ✓ Testi u ruajt.{" "}
            <Link href={`/b/${slug}`}>
              Kthehu te Dashboard për të filluar →
            </Link>
          </p>
        )}
        {last?.setupNotice && <p role="status">{last.setupNotice}</p>}
      </div>
      <header className="agent-test-header">
        <div>
          <span className="agent-test-label">
            <span /> SESION PROVE
          </span>
          <h2>{businessName}</h2>
          <p>
            Përdor agjentin aktiv, njohuritë dhe katalogun e këtij biznesi. Nuk
            dërgon mesazhe në Instagram dhe nuk krijon biseda ose porosi reale.
          </p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={reset}>
          ↻ Rifillo
        </button>
      </header>
      <div className="agent-test-layout">
        <div className="agent-test-conversation">
          <div
            className="agent-test-log"
            ref={chatLog}
            role="log"
            aria-label="Biseda e provës"
            aria-live="polite"
          >
            {!messages.length && !pending && (
              <div className="agent-test-empty">
                <Icon name="inbox" size={32} />
                <h3>Shkruaj si klient</h3>
                <p>
                  Fillo me emrin e një produkti nga katalogu yt ose bëj një
                  pyetje për biznesin.
                </p>
                <span>
                  Prova funksionon edhe kur përgjigjet automatike janë të
                  fikura.
                </span>
              </div>
            )}
            {messages.map((m, i) => (
              <div className={`agent-test-bubble ${m.role}`} key={i}>
                <small>
                  {m.role === "customer" ? "Ti · si klient" : "Agjenti"}
                </small>
                <p>{m.text}</p>
              </div>
            ))}
            {pending && (
              <>
                <div className="agent-test-bubble customer">
                  <small>Ti · si klient</small>
                  <p>{pending}</p>
                </div>
                <p className="agent-test-thinking" role="status">
                  Agjenti po përgjigjet…
                </p>
              </>
            )}
          </div>
          <form onSubmit={send} className="agent-test-composer">
            <label htmlFor="agent-test-message" className="sr-only">
              Mesazhi i provës
            </label>
            <textarea
              id="agent-test-message"
              value={draft}
              maxLength={2000}
              rows={3}
              placeholder="Shkruaj si klient…"
              disabled={pending !== null}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div>
              <label className="agent-test-photo">
                <input
                  type="checkbox"
                  checked={photo}
                  disabled={pending !== null}
                  onChange={(e) => setPhoto(e.target.checked)}
                />{" "}
                Simulo foto <small>(pa ngarkuar skedar)</small>
              </label>
              <button
                type="submit"
                className="agent-test-send"
                disabled={pending !== null || (!draft.trim() && !photo)}
              >
                {pending !== null ? "Duke provuar…" : "Dërgo"}
                <Icon name="arrow" size={16} />
              </button>
            </div>
            {error && (
              <p role="alert" className="agent-test-error">
                {error}
              </p>
            )}
            <p className="agent-test-disclaimer">
              Sesioni pastrohet me Rifillo ose kur largohesh nga faqja. Teksti i
              provës përpunohet nga AI kur është konfiguruar; përdor të dhëna
              shembull.
            </p>
          </form>
        </div>
        <aside className="agent-test-debug">
          <h3>Workflow i porosisë</h3>
          {!last ? (
            <p className="agent-test-disclaimer">
              Pas mesazhit të parë shfaqen hapat: çfarë u plotësua dhe çfarë
              mungon.
            </p>
          ) : (
            <ol className="agent-test-steps" aria-label="Hapat e porosisë">
              {(last.workflowProgress ?? []).map((step) => (
                <li
                  key={step.key}
                  className={`agent-test-step is-${step.status}`}
                >
                  <span className="agent-test-step-mark" aria-hidden>
                    {step.status === "done"
                      ? "✓"
                      : step.status === "current"
                        ? "●"
                        : "○"}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>
                      {step.status === "done"
                        ? "U plotësua"
                        : step.status === "current"
                          ? "Hapi aktual — përgjigju këtu"
                          : "Në pritje"}
                      {step.value ? ` · ${step.value}` : ""}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <dl>
            <div>
              <dt>Produkti</dt>
              <dd>{last?.productName || "—"}</dd>
            </div>
            <div>
              <dt>Hapi aktual</dt>
              <dd>{last?.nextState.step_key || "choose_product"}</dd>
            </div>
            <div>
              <dt>Mesazhe prove</dt>
              <dd>{last?.turns || 0} / 40</dd>
            </div>
            <div>
              <dt>Burimi i përgjigjes</dt>
              <dd>
                {last
                  ? last.debug.source === "ai"
                    ? "Inteligjenca artificiale"
                    : "Përgjigje rezervë"
                  : "—"}
              </dd>
            </div>
            {last && (
              <>
                <div>
                  <dt>Koha e përgjigjes</dt>
                  <dd>{(last.debug.elapsedMs / 1000).toFixed(1)} sek</dd>
                </div>
                <div>
                  <dt>Dërgimi automatik</dt>
                  <dd>
                    {last.autoReplyEnabled ? "Aktiv" : "Joaktiv"} · jo në provë
                  </dd>
                </div>
              </>
            )}
          </dl>
          {last && !last.debug.agentConfigured && (
            <p className="agent-test-notice">
              Nuk ka udhëzime nga një agjent aktiv. Po përdoren udhëzimet bazë.{" "}
              <Link href={`/b/${slug}/agents`}>Konfiguro agjentin →</Link>
            </p>
          )}
          {last?.debug.fallbackReason && (
            <p role="status" className="agent-test-notice">
              {reasons[last.debug.fallbackReason] ||
                "U përdor përgjigjja rezervë."}
            </p>
          )}
          {last && !last.nextState.product_id && (
            <p className="agent-test-notice">
              Produkti nuk u njoh ende. Shkruaj emrin e saktë nga katalogu (p.sh.
              emri i produktit).
            </p>
          )}
          {last?.turns === 40 && (
            <p className="agent-test-notice">
              U arritën 40 mesazhe. Shtyp Rifillo për një provë të re.
            </p>
          )}
          <details>
            <summary>Të dhënat e mbledhura (JSON)</summary>
            <pre>
              {JSON.stringify(
                last?.nextState ?? {
                  step_key: "choose_product",
                  fields: {},
                  customer: {},
                },
                null,
                2,
              )}
            </pre>
          </details>
          <p className="agent-test-disclaimer">
            Fotoja e simuluar teston vetëm hapin e workflow-t. Nuk ngarkohet apo
            analizohet një imazh.
          </p>
        </aside>
      </div>
    </section>
  );
}
