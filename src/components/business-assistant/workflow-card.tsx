"use client";
import { useState } from "react";
import Link from "next/link";
import type { WorkflowCard as WorkflowCardData } from "@/lib/business-assistant/workflow";
import {
  describeWorkflowNode,
  workflowProblems,
} from "@/lib/business-assistant/workflow";
import type { VisualGraph } from "@/lib/workflows/visual/types";
import "./workflow-card.css";

function FlowSteps({ graph }: { graph: VisualGraph }) {
  // Traverse from start; array order is the editor's storage order, not execution order.
  const ids: string[] = [];
  const visit = (id: string) => {
    if (ids.includes(id)) return;
    ids.push(id);
    graph.edges.filter((e) => e.source === id).forEach((e) => visit(e.target));
  };
  const start = graph.nodes.find((n) => n.kind === "start");
  if (start) visit(start.id);
  graph.nodes.forEach((n) => visit(n.id));
  return (
    <ol className="assistant-flow-steps">
      {ids.map((id) => {
        const node = graph.nodes.find((n) => n.id === id)!;
        return (
          <li key={id}>
            <strong>{node.label}</strong>
            <p>{describeWorkflowNode(node)}</p>
            <div>
              {graph.edges
                .filter((e) => e.source === id)
                .map((e) => (
                  <span key={e.id}>
                    {e.port === "yes"
                      ? "Po"
                      : e.port === "no"
                        ? "Jo"
                        : "Vazhdo"}{" "}
                    → {graph.nodes.find((n) => n.id === e.target)?.label}
                  </span>
                ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
function WorkflowTrial({ graph, slug }: { graph: VisualGraph; slug: string }) {
  const [session, setSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ from: string; text: string }[]>(
    [],
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [handoff, setHandoff] = useState(false);
  async function send() {
    if (busy || !message.trim() || handoff) return;
    const submitted = message.trim();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/business-assistant?slug=${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "workflow_test",
            graph,
            message: submitted,
            session,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || result.error)
        throw new Error(result.error ?? "Prova nuk përfundoi.");
      setMessages((previous) => [
        ...previous,
        { from: "Ti si klient", text: submitted },
        { from: "Agjenti", text: result.reply },
      ]);
      setSession(result.session);
      setHandoff(result.handoff === true && result.advisoryHandoff !== true);
      setMessage("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="assistant-flow-trial">
      <summary>Provoje si klient</summary>
      <p>Kjo është bisedë prove; nuk dërgon mesazhe te klientët.</p>
      <div aria-live="polite">
        {messages.map((m, i) => (
          <p key={i}>
            <strong>{m.from}</strong>
            <br />
            {m.text}
          </p>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Mesazhi i provës së rrjedhës"
          placeholder="P.sh. Dua të porosis…"
          rows={2}
          maxLength={2000}
          value={message}
          disabled={busy || handoff}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div>
          <button
            type="submit"
            className="assistant-primary"
            disabled={busy || handoff || !message.trim()}
          >
            {busy ? "Po provon…" : "Dërgo në provë"}
          </button>
          <button
            type="button"
            className="assistant-secondary"
            disabled={busy}
            onClick={() => {
              setSession(null);
              setMessages([]);
              setError("");
              setHandoff(false);
            }}
          >
            Rifillo
          </button>
        </div>
      </form>
    </details>
  );
}
export function WorkflowCard({
  data,
  slug,
  pending,
  onRequest,
}: {
  data: WorkflowCardData;
  slug: string;
  pending: boolean;
  onRequest: (text: string) => void;
}) {
  const { workspace, published, proposed } = data;
  const [tab, setTab] = useState<"draft" | "published">("draft");
  const graph =
    tab === "published" && published
      ? published
      : (proposed ?? workspace.graph);
  const problems = workflowProblems(graph);
  return (
    <section className="assistant-flow-card" aria-label="Rrjedha e Agjentit">
      <header>
        <small>RRJEDHA E BIZNESIT</small>
        <h3>{graph.name}</h3>
        <p>
          {tab === "published"
            ? workspace.enabled
              ? "Versioni aktiv"
              : "Version i publikuar, joaktiv"
            : proposed
              ? "Propozim · ende i paruajtur"
              : workspace.generated
                ? "Sugjerim fillestar · i paruajtur"
                : "Draft i ruajtur"}
        </p>
      </header>
      <div
        className="assistant-flow-tabs"
        role="group"
        aria-label="Versioni i rrjedhës"
      >
        <button
          type="button"
          aria-pressed={tab === "draft"}
          onClick={() => setTab("draft")}
        >
          {proposed ? "Propozimi" : "Drafti"}
        </button>
        {published && (
          <button
            type="button"
            aria-pressed={tab === "published"}
            onClick={() => setTab("published")}
          >
            I publikuar
          </button>
        )}
      </div>
      {!workspace.available && (
        <p role="status">
          Kjo është rrjedhë e sugjeruar. Ruajtja dhe publikimi presin
          konfigurimin nga administratori.
        </p>
      )}
      <FlowSteps graph={graph} />
      {problems.length > 0 ? (
        <details>
          <summary>Duhet plotësuar para publikimit ({problems.length})</summary>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </details>
      ) : (
        <WorkflowTrial key={JSON.stringify(graph)} graph={graph} slug={slug} />
      )}
      {Boolean(data.versions?.length) && (
        <details>
          <summary>Versionet e fundit</summary>
          <ul>
            {data.versions?.map((version) => (
              <li key={version.id}>
                <span>
                  {new Date(version.created_at).toLocaleString("sq-AL")}
                </span>{" "}
                <button
                  type="button"
                  className="assistant-secondary"
                  disabled={pending}
                  onClick={() =>
                    onRequest(
                      `Rikthe si draft versionin e rrjedhës të publikuar më ${version.created_at}.`,
                    )
                  }
                >
                  Kthe si draft…
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <footer>
        <Link href={`/b/${slug}/workflows`}>Hap editorin →</Link>
        {!pending && !proposed && tab === "draft" && (
          <button
            type="button"
            className="assistant-secondary"
            onClick={() =>
              onRequest(
                "Publiko dhe aktivizo draftin aktual të rrjedhës së biznesit.",
              )
            }
            disabled={!workspace.available || problems.length > 0}
          >
            Publiko draftin…
          </button>
        )}
        {!pending &&
          !proposed &&
          tab === "published" &&
          published &&
          workspace.available &&
          (workspace.enabled ? (
            <button
              type="button"
              className="assistant-secondary"
              onClick={() =>
                onRequest(
                  "Çaktivizo rrjedhën e publikuar për bisedat e reja.",
                )
              }
            >
              Çaktivizo…
            </button>
          ) : (
            <button
              type="button"
              className="assistant-secondary"
              onClick={() =>
                onRequest(
                  "Aktivizo versionin e publikuar të rrjedhës për bisedat e reja.",
                )
              }
            >
              Aktivizo…
            </button>
          ))}
      </footer>
    </section>
  );
}
