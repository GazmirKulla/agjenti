"use client";
import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AudioRecorder } from "@/components/onboarding/audio-recorder";
import {
  emptyDraft,
  entityValidationIssues,
  normalizeDraftCurrencies,
  type EntityValidationIssue,
  fields,
  labels,
  value,
  type Draft,
  type Source,
  type Target,
} from "@/lib/business-intelligence/model";
import { scanKnowledge, reviewEntities, knowledgeNotice } from "@/lib/business-intelligence/scan-routing";
import "./panel.css";
const sections: Record<string, Target> = {
  products: "product",
  agents: "agent",
  knowledge: "knowledge",
  workflows: "workflow",
  settings: "profile",
  services: "service",
};
export function BusinessIntelligencePanel({ slug }: { slug: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname.split("/")[3] ?? "";
  const initialTarget = sections[section];
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [issues, setIssues] = useState<EntityValidationIssue[]>([]);
  const [knowledgeCount, setKnowledgeCount] = useState(0);
  const [note, setNote] = useState("");
  const [source, setSource] = useState<Source>("audio");
  const [target, setTarget] = useState<Target>(initialTarget ?? "profile");
  const [text, setText] = useState("");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [revision, setRevision] = useState(0);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [resolved, setResolved] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const endpoint = `/api/business-intelligence?slug=${encodeURIComponent(slug)}`;
  async function open() {
    setOpened(true);
    setTarget(initialTarget ?? "profile");
    dialog.current?.showModal();
    setBusy(true);
    setError(""); setIssues([]); setKnowledgeCount(0); setNote(""); setSelected([]); setEdits({}); setResolved([]); setConfirmed(false);
    try {
      const r = await fetch(endpoint);
      let data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setDraft(normalizeDraftCurrencies(data.draft)); setRevision(data.revision);
      if (scanKnowledge(data.draft).length) {
        const routed = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "route_knowledge", revision: data.revision }) });
        const result = await routed.json();
        if (!routed.ok) throw new Error(result.error);
        data = result;
        setKnowledgeCount(data.knowledgeCount ?? 0); setNote(data.note ?? "");
        router.refresh();
      }
      setDraft(normalizeDraftCurrencies(data.draft));
      setRevision(data.revision);
      setEdits({});
      setResolved([]);
      setSelected([]);
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nuk u ngarkua drafti.");
    } finally {
      setBusy(false);
    }
  }
  async function run(action: string, file?: File) {
    setBusy(true);
    setError("");
    setNote(""); setIssues([]);
    try {
      const payload = {
        action,
        revision,
        source,
        target,
        text,
        values: source === "manual" ? manual : undefined,
        edits: Object.entries(edits).map(([id, values]) => ({ id, values })),
        selected,
        resolved,
        confirmed,
      };
      let body: BodyInit;
      let headers: HeadersInit | undefined;
      if (file) {
        const form = new FormData();
        form.set("audio", file);
        form.set("answers", JSON.stringify(payload));
        body = form;
      } else {
        body = JSON.stringify(payload);
        headers = { "Content-Type": "application/json" };
      }
      const r = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(170000),
      });
      const data = await r.json();
      if (!r.ok) {
        if (Array.isArray(data.issues)) { setIssues(data.issues); setExpanded(current => ({ ...current, ...Object.fromEntries(data.issues.map((issue: EntityValidationIssue) => [issue.entityId, true])) })); }
        throw new Error(data.error);
      }
      setDraft(normalizeDraftCurrencies(data.draft));
      if (data.knowledgeCount) { setKnowledgeCount(count => count + data.knowledgeCount); router.refresh(); }
      if (data.inactiveKnowledgeCount) setNote(`${data.note ?? ""} ${data.inactiveKnowledgeCount} përgjigje të ndryshme u ruajtën joaktive; kontrolloji te Njohuritë.`);
      setRevision(data.revision);
      setEdits({});
      setResolved([]);
      setConfirmed(false);
      if (!data.inactiveKnowledgeCount) setNote(data.success ?? data.note ?? "Drafti u ruajt.");
      if (action === "ingest") setSelected(reviewEntities(data.draft, target).filter(entity => (data.reviewIds ?? []).includes(entity.id) && !entityValidationIssues([entity]).length && !data.draft.conflicts.some((conflict: { entityId: string }) => conflict.entityId === entity.id)).map(entity => entity.id));
      if (action === "apply") {
        setSelected([]);
        router.refresh();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Veprimi dështoi. Provo përsëri.",
      );
    } finally {
      setBusy(false);
    }
  }
  function edit(id: string, field: string, text: string) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], [field]: text } }));
    setConfirmed(false);
    setResolved(current => [...new Set([...current, `${id}:${field}`])]);
    setIssues(current => current.filter(issue => issue.entityId !== id || issue.field !== field));
  }
  useEffect(() => {
    if (
      section === "products" ||
      section === "agents" ||
      section === "workflows"
    )
      return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.source) setSource(detail.source);
      void open();
    };
    window.addEventListener("business-intelligence:open", listener);
    return () =>
      window.removeEventListener("business-intelligence:open", listener);
  });
  if (
    !initialTarget ||
    section === "products" ||
    section === "agents" ||
    section === "workflows" ||
    (section !== "products" && pathname.split("/").length > 4)
  )
    return null;
  return (
    <div className="bi-entry">
      <button
        hidden={section === "products"}
        className="btn btn-ghost"
        onClick={() => void open()}
      >
        ✨ Plotëso me AI
      </button>
      <dialog
        ref={dialog}
        className="bi-dialog"
        aria-labelledby="bi-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setOpened(false);
        }}
        onClose={() => setOpened(false)}
      >
        {opened && (
          <>
            <header>
              <div>
                <h2 id="bi-title">Plotëso hapësirën tënde</h2>
                <p>
                  Jep informacion, rishiko propozimet dhe zgjidh çfarë të ruash.
                </p>
              </div>
              <button
                className="bi-close"
                disabled={busy}
                onClick={() => dialog.current?.close()}
                aria-label="Mbyll"
              >
                ×
              </button>
            </header>
            <fieldset className="bi-content" disabled={busy}>
              <label>
                Seksioni
                <select
                  value={target}
                  disabled={busy}
                  onChange={(e) => {
                    setTarget(e.target.value as Target);
                    setManual({}); setSelected([]); setConfirmed(false); setIssues([]);
                  }}
                >
                  {Object.entries(labels)
                    .filter(
                      ([k]) =>
                        Object.hasOwn(fields, k) &&
                        k !== "product" &&
                        k !== "agent" &&
                        k !== "workflow",
                    )
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </select>
              </label>
              <div className="bi-sources">
                {(
                  [
                    ["audio", "🎙 Shpjego me audio"],
                    ["website", "🌐 Skano website-in"],
                    ["instagram", "📸 Analizo Instagram-in"],
                    ["manual", "✍ Plotëso manualisht"],
                    ["ai_inferred", "Nga të dhënat ekzistuese"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    className={`btn ${source === key ? "btn-primary" : "btn-ghost"}`}
                    disabled={busy}
                    key={key}
                    onClick={() => setSource(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {source === "audio" ? (
                <AudioRecorder
                  busy={busy}
                  onAnalyze={(file) => run("ingest", file)}
                />
              ) : source === "manual" ? (
                <div className="bi-fields">
                  {fields[target].map((field) => (
                    <label key={field}>
                      {labels[field]}
                      <textarea
                        rows={field === "steps" ? 5 : 2}
                        value={manual[field] ?? ""}
                        onChange={(e) =>
                          setManual((m) => ({ ...m, [field]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
                  <button
                    disabled={busy}
                    className="btn btn-primary"
                    onClick={() => void run("ingest")}
                  >
                    Shto në draft
                  </button>
                </div>
              ) : (
                <div className="bi-input">
                  {source === "website" ? (
                    <label>
                      Website ose faqe produkti
                      <input
                        type="url"
                        placeholder="https://biznesi.al"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </label>
                  ) : (
                    <p>
                      {source === "instagram"
                        ? "Lexohen postimet e llogarisë së lidhur. Nuk dërgohen mesazhe."
                        : "Përdoren profili, katalogu dhe njohuritë e ruajtura. Propozimet kërkojnë konfirmim."}
                    </p>
                  )}
                  <button
                    disabled={busy}
                    className="btn btn-primary"
                    onClick={() => void run("ingest")}
                  >
                    {busy ? "Duke analizuar…" : "Analizo dhe përgatit draftin"}
                  </button>
                </div>
              )}
              {error && (
                <p role="alert" className="bi-error">
                  {error}
                </p>
              )}
              {note && <p role="status">{note}</p>}
              <div className="bi-review-head">
                <h3>Rishiko dhe konfirmo</h3>
                <button
                  className="btn btn-ghost"
                  disabled={busy || !revision}
                  onClick={() => void run("refresh")}
                >
                  Rilexo të dhënat aktive
                </button>
              </div>
              <p>
                Produktet dhe konfigurimet ruhen pasi t’i konfirmosh. FAQ-të dhe informacioni i përgjithshëm nga website-i ose Instagram-i dërgohen automatikisht te Njohuritë.
              </p>
              <p className="bi-knowledge-notice">{knowledgeCount > 0 ? `${knowledgeNotice(knowledgeCount)} ` : "FAQ-të menaxhohen te Njohuritë. "}<Link className="soft-link" href={`/b/${slug}/knowledge`}>Shiko Njohuritë →</Link></p>
              {issues.length > 0 && <ul className="bi-validation" role="alert">{issues.map(issue => <li key={`${issue.entityId}:${issue.field}`}>{draft.entities.find(entity => entity.id === issue.entityId)?.facts.find(fact => fact.field === "name" || fact.field === "title")?.value || labels[target]} · {labels[issue.field] ?? issue.field}: {issue.message}</li>)}</ul>}
              {entityValidationIssues(reviewEntities(draft, target)).length > 0 && (
                <p role="status">
                  Mungojnë disa të dhëna. Hap elementin për ta plotësuar
                  manualisht ose shto një audio sqaruese.
                </p>
              )}
              {reviewEntities(draft, target).map((entity) => (
                <details className={`bi-entity${issues.some(issue => issue.entityId === entity.id) ? " has-errors" : ""}`} open={expanded[entity.id]} onToggle={event => { const open = event.currentTarget.open; setExpanded(current => current[entity.id] === open ? current : { ...current, [entity.id]: open }); }} key={entity.id}>
                  <summary>
                    {labels[entity.target]} ·{" "}
                    {value(entity, "name") ||
                      value(entity, "title") ||
                      labels[entity.target]}{" "}
                    {draft.conflicts.some((c) => c.entityId === entity.id)
                      ? " · Konflikt"
                      : ""}
                  </summary>
                  <label className="bi-check">
                    <input
                      type="checkbox"
                      checked={selected.includes(entity.id)}
                      onChange={(e) => {
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, entity.id]
                            : ids.filter((id) => id !== entity.id),
                        );
                        setConfirmed(false);
                      }}
                    />
                    Përfshi në ruajtje
                  </label>
                  {fields[entity.target].filter(field => value(entity, field) || (entity.target === "product" ? ["name", "price", "currency"] : entity.target === "knowledge" ? ["title", "body"] : entity.target === "workflow" ? ["name", "steps"] : entity.target === "agent" ? ["rules"] : ["name"]).includes(field)).map((field) => {
                    const fact = entity.facts.find((f) => f.field === field);
                    const conflicts = draft.conflicts.filter(
                      (c) => c.entityId === entity.id && c.field === field,
                    );
                    const current =
                      edits[entity.id]?.[field] ?? fact?.value ?? "";
                    return (
                      <div key={field}>
                        <label>
                          {labels[field]}
                          {draft.missingInformation.includes(
                            `${entity.id}:${field}`,
                          )
                            ? " · Kërkohet sqarim"
                            : ""}
                          <textarea
                            aria-invalid={issues.some(issue => issue.entityId === entity.id && issue.field === field)}
                            rows={field === "steps" ? 5 : 2}
                            value={current}
                            onChange={(e) =>
                              edit(entity.id, field, e.target.value)
                            }
                          />
                        </label>
                        <small>
                          {fact
                            ? `${fact.source} · ${fact.confirmedByUser ? "Konfirmuar" : `${Math.round(fact.confidence * 100)}% besim${fact.confidence < 0.8 ? " · Kërkon kontroll" : ""}`}`
                            : "E panjohur — plotëso nëse e di"}
                        </small>
                        {fact?.evidence && (
                          <blockquote>{fact.evidence}</blockquote>
                        )}
                        {conflicts.length > 0 && (
                          <div className="bi-conflict">
                            <p>
                              Gjetëm informacione të ndryshme. Cili është i
                              saktë?
                            </p>
                            {conflicts.map((c, i) => (
                              <p key={i}>
                                {c.incoming.source}: {c.incoming.value}
                                <button
                                  className="btn btn-ghost"
                                  onClick={() =>
                                    edit(
                                      entity.id,
                                      field,
                                      c.incoming.value ?? "",
                                    )
                                  }
                                >
                                  Përdor këtë vlerë
                                </button>
                              </p>
                            ))}
                            <label className="bi-check">
                              <input
                                type="checkbox"
                                checked={resolved.includes(
                                  `${entity.id}:${field}`,
                                )}
                                onChange={(e) => {
                                  const key = `${entity.id}:${field}`;
                                  setResolved((a) =>
                                    e.target.checked
                                      ? [...a, key]
                                      : a.filter((k) => k !== key),
                                  );
                                  setConfirmed(false);
                                }}
                              />
                              Konfirmoj vlerën e shfaqur në fushë
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </details>
              ))}
              {!reviewEntities(draft, target).length && (
                <p>Nuk ka propozime për këtë seksion. Informacioni i përgjithshëm nga skanimet ruhet te Njohuritë.</p>
              )}
              <label className="bi-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I kontrollova të dhënat e përzgjedhura, përfshirë çmimet dhe
                politikat.
              </label>
              <footer>
                <button
                  className="btn btn-ghost"
                  disabled={busy || !revision}
                  onClick={() => void run("save")}
                >
                  Ruaj draftin
                </button>
                <button
                  className="btn btn-primary"
                  disabled={busy || !confirmed || !selected.length}
                  onClick={() => void run("apply")}
                >
                  {busy ? "Duke punuar…" : "Konfirmo dhe apliko"}
                </button>
              </footer>
            </fieldset>
          </>
        )}
      </dialog>
    </div>
  );
}
