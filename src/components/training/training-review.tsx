"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Price = { min: number; max: number | null; currency: string; text?: string; condition?: string | null; ageDays?: number };
export type Suggestion = {
  id: string; destination: string; operation: "create" | "update" | "duplicate" | "conflict"; title: string;
  current_value: Record<string, unknown> | null; proposed: Record<string, unknown>; edited: Record<string, unknown> | null;
  evidence: { quote: string; speaker: string; at: string }[]; confidence: "high" | "medium" | "low";
  explicit: boolean; requires_confirmation: boolean; risk: "safe" | "important";
  status: "pending" | "approved" | "rejected" | "applied" | "failed" | "superseded";
  applied_ref: { state?: string; message?: string; error?: string } | null;
};

const TABS: { key: string; label: string; match: (s: Suggestion) => boolean }[] = [
  { key: "style", label: "Stili", match: (s) => s.destination === "style" },
  { key: "knowledge", label: "Njohuritë", match: (s) => ["knowledge", "profile", "gap"].includes(s.destination) },
  { key: "product", label: "Produktet", match: (s) => s.destination === "product" },
  { key: "service", label: "Shërbimet", match: (s) => s.destination === "service" },
  { key: "prices", label: "Çmimet", match: (s) => ["product", "service"].includes(s.destination) && !!s.proposed.price },
  { key: "workflow", label: "Proceset", match: (s) => s.destination === "workflow" },
  { key: "example", label: "Shembuj realë", match: (s) => s.destination === "example" },
];
const OPERATION: Record<string, string> = { create: "E re", update: "Plotëson të tanishmen", duplicate: "E ke tashmë", conflict: "Ndryshon nga e tanishmja" };
const STATUS: Record<string, string> = { approved: "E miratuar", rejected: "E refuzuar", applied: "U aplikua", failed: "Nuk u aplikua", superseded: "E zëvendësuar" };
const CONFIDENCE: Record<string, string> = { high: "Thënë qartë në biseda", medium: "Thënë një herë ose nga Agjenti", low: "E nxjerrë, jo e thënë drejt" };
const DESTINATION: Record<string, string> = { knowledge: "Njohuri", profile: "Profili i biznesit", gap: "Pyetje pa përgjigje", product: "Produkt", service: "Shërbim", workflow: "Proces", example: "Shembull", style: "Stili" };
const date = (value?: string) => (value ? new Date(value).toLocaleDateString("sq-AL", { day: "numeric", month: "short", year: "numeric" }) : "");
const money = (p?: Price | null) => (p ? `${p.min}${p.max ? `–${p.max}` : ""} ${p.currency === "ALL" ? "lekë" : p.currency}${p.condition ? ` (${p.condition})` : ""}` : "");

function current(s: Suggestion): string {
  const c = s.current_value;
  if (!c) return "";
  if (Array.isArray(c.hours)) return `Orari në kalendar: ${(c.hours as { day: number; start: string; end: string }[]).map((h) => `${["", "E hënë", "E martë", "E mërkurë", "E enjte", "E premte", "E shtunë", "E diel"][h.day] ?? h.day} ${h.start}–${h.end}`).join(", ")}`;
  if (s.destination === "style") return "";
  const price = c.price as Price | null | undefined;
  return [c.name ?? c.title, c.description ?? c.body, price ? `Çmimi: ${money(price)}` : (s.destination === "product" || s.destination === "service") ? "Pa çmim" : ""].filter(Boolean).join("\n");
}
function proposed(s: Suggestion): string {
  const p = { ...s.proposed, ...(s.edited ?? {}) } as Record<string, unknown>;
  if (s.destination === "style") return String(p.instructions ?? "");
  if (s.destination === "example") return `Klienti: ${p.customer_message}\nTi: ${p.desired_response}`;
  if (s.destination === "gap") return p.body ? `Përgjigjja: ${p.body}` : `Klientët e kanë pyetur ${p.timesAsked ?? 1} herë, por nuk morën përgjigje.`;
  if (s.destination === "workflow") return p.body ? String(p.body) : (Array.isArray(p.steps) ? (p.steps as string[]).map((x, i) => `${i + 1}. ${x}`).join("\n") : "");
  const price = (s.edited && "price" in s.edited ? s.edited.price : p.price) as Price | null;
  const others = Array.isArray(p.prices) && (p.prices as Price[]).length > 1 ? `\nÇmime të tjera në biseda: ${(p.prices as Price[]).slice(1).map(money).join(" · ")}` : "";
  return [p.description ?? p.body, price ? `Çmimi: ${money(price)}${price.ageDays !== undefined && price.ageDays > 120 ? ` · u tha ${price.ageDays} ditë më parë, mund të ketë ndryshuar` : ""}${others}` : ""].filter(Boolean).join("\n");
}

type Draft = Record<string, string>;
function editFields(s: Suggestion): { key: string; label: string; long?: boolean }[] {
  switch (s.destination) {
    case "style": return [{ key: "instructions", label: "Si duhet të shkruajë Agjenti", long: true }];
    case "example": return [{ key: "customer_message", label: "Mesazhi i klientit", long: true }, { key: "desired_response", label: "Përgjigjja jote", long: true }];
    case "product": case "service": return [{ key: "name", label: "Emri" }, { key: "description", label: "Përshkrimi", long: true }, { key: "min", label: "Çmimi nga" }, { key: "max", label: "Çmimi deri (bosh për çmim fiks)" }];
    case "profile": return [{ key: "body", label: s.title, long: true }];
    case "gap": return [{ key: "title", label: "Pyetja" }, { key: "body", label: "Përgjigjja që duhet të japë Agjenti", long: true }];
    default: return [{ key: "title", label: "Titulli" }, { key: "body", label: "Përmbajtja", long: true }];
  }
}
function initialDraft(s: Suggestion): Draft {
  const p = { ...s.proposed, ...(s.edited ?? {}) } as Record<string, unknown>;
  const price = (s.edited && "price" in s.edited ? s.edited.price : p.price) as Price | null;
  const steps = Array.isArray(p.steps) ? (p.steps as string[]).map((x, i) => `${i + 1}. ${x}`).join("\n") : "";
  return {
    instructions: String(p.instructions ?? ""), customer_message: String(p.customer_message ?? ""), desired_response: String(p.desired_response ?? ""),
    name: String(p.name ?? ""), description: String(p.description ?? ""), min: price ? String(price.min) : "", max: price?.max ? String(price.max) : "",
    title: String(p.title ?? p.question ?? p.name ?? s.title), body: String(p.body ?? steps),
  };
}
function editPayload(s: Suggestion, d: Draft): Record<string, unknown> {
  const fields = editFields(s).map((f) => f.key);
  if (s.destination === "product" || s.destination === "service") {
    const currency = String((s.proposed.price as Price | null)?.currency ?? "ALL");
    const min = d.min.trim() ? Number(d.min.replace(",", ".")) : null, max = d.max.trim() ? Number(d.max.replace(",", ".")) : null;
    return { name: d.name, description: d.description, price: min === null ? null : { min, max, currency } };
  }
  return Object.fromEntries(fields.map((key) => [key, d[key]]));
}

/** Steps 3, 4 and 6: what the agent learned, by section, for the owner to approve, change or reject, then apply. */
export function TrainingReview({ endpoint, sessionId, onApplied }: { endpoint: string; sessionId: string; onApplied?: () => void }) {
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [tab, setTab] = useState("style");
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<{ title: string; ok: boolean; message: string }[] | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`${endpoint}&session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { setError(data.error || "Sugjerimet nuk u ngarkuan."); return; }
    const list = (data.suggestions ?? []) as Suggestion[];
    setItems(list);
    setTab((t) => (list.some(TABS.find((x) => x.key === t)!.match) ? t : TABS.find((x) => list.some(x.match))?.key ?? "style"));
  }, [endpoint, sessionId]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Veprimi nuk u krye.");
    return data;
  }
  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(label); setError("");
    try { await work(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Veprimi nuk u krye."); }
    finally { setBusy(""); }
  }
  const decide = (s: Suggestion, decision: "approve" | "reject", edited?: Record<string, unknown>) =>
    act(s.id, async () => { await post({ action: "decide", id: s.id, decision, ...(edited ? { edited } : {}) }); setEditing(null); });

  async function apply() {
    setBusy("apply"); setError(""); setResults(null);
    try {
      const all: { title: string; ok: boolean; message: string }[] = [];
      for (let i = 0; i < 10; i++) {
        const data = await post({ action: "apply", id: sessionId });
        all.push(...data.results);
        if (!data.remaining) break;
      }
      setResults(all);
      await load();
      onApplied?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Aplikimi nuk u krye."); }
    finally { setBusy(""); }
  }

  const counts = useMemo(() => {
    const list = items ?? [];
    const safe = list.filter((s) => s.status === "pending" && s.risk === "safe" && !s.requires_confirmation && s.destination !== "gap" && (s.operation === "create" || (s.destination === "style" && s.operation === "update"))).length;
    return { safe, approved: list.filter((s) => s.status === "approved" && !s.applied_ref).length, pending: list.filter((s) => s.status === "pending" && s.operation !== "duplicate").length };
  }, [items]);

  if (!items) return <p className="training-note">{error || "Po ngarkoj çfarë mësoi Agjenti…"}</p>;
  if (!items.length) return <p className="training-note">Nuk u gjet asgjë e re: Agjenti i di tashmë këto ose bisedat ishin shumë të pakta.</p>;
  const visible = items.filter(TABS.find((t) => t.key === tab)!.match);

  return (
    <div className="training-review">
      <div className="training-tabs" role="tablist">
        {TABS.map((t) => {
          const n = items.filter(t.match).length;
          return n ? <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "is-active" : ""} onClick={() => setTab(t.key)}>{t.label} <span>{n}</span></button> : null;
        })}
      </div>
      {tab === "prices" && <p className="training-note">Çmimet nga bisedat mund të jenë të vjetra. Asnjë nuk ruhet pa e konfirmuar ti, dhe asnjë nuk zëvendëson një çmim aktual pa miratimin tënd.</p>}
      {tab === "style" && <p className="training-note">Kjo i tregon Agjentit si të shkruajë si ti. Ruhet në një pjesë të veçantë të udhëzimeve; çfarë ke shkruar vetë nuk preket.</p>}
      <ul className="training-cards">
        {visible.map((s) => {
          const isEditing = editing?.id === s.id;
          const before = current(s), after = proposed(s);
          const done = ["applied", "rejected", "superseded"].includes(s.status);
          return (
            <li key={s.id} className={`training-suggestion is-${s.status} risk-${s.risk}`}>
              <div className="training-suggestion-head">
                <div><small>{DESTINATION[s.destination]}</small><b>{s.title}</b></div>
                <span className={`training-badge is-${s.operation}`}>{STATUS[s.status] ?? OPERATION[s.operation]}</span>
              </div>
              {before && <div className="training-compare"><span>Tani</span><p>{before}</p></div>}
              {!isEditing && after && <div className="training-compare is-new"><span>{before ? "Propozimi" : "Çfarë mësoi"}</span><p>{after}</p></div>}
              {isEditing && (
                <div className="training-edit">
                  {editFields(s).map((f) => (
                    <label key={f.key}><span>{f.label}</span>
                      {f.long ? <textarea className="field" rows={f.key === "instructions" ? 10 : 3} value={editing.draft[f.key]} onChange={(e) => setEditing({ id: s.id, draft: { ...editing.draft, [f.key]: e.target.value } })} />
                        : <input className="field" inputMode={["min", "max"].includes(f.key) ? "decimal" : undefined} value={editing.draft[f.key]} onChange={(e) => setEditing({ id: s.id, draft: { ...editing.draft, [f.key]: e.target.value } })} />}
                    </label>
                  ))}
                </div>
              )}
              <p className="training-meta">
                {CONFIDENCE[s.confidence]}
                {s.requires_confirmation && s.status === "pending" ? " · Duhet ta konfirmosh ti" : ""}
                {s.operation === "duplicate" ? " · Nuk ka nevojë të shtohet" : ""}
              </p>
              {s.applied_ref?.message && <p className="training-done">{s.applied_ref.message}</p>}
              {s.applied_ref?.error && <p className="training-error">{s.applied_ref.error}</p>}
              {s.evidence.length > 0 && (
                <details className="training-evidence"><summary>Nga bisedat ({s.evidence.length})</summary>
                  <ul>{s.evidence.map((e, i) => <li key={i}><em>{e.speaker === "customer" ? "Klienti" : e.speaker === "agent" ? "Agjenti" : "Ti"} · {date(e.at)}</em> «{e.quote}»</li>)}</ul>
                </details>
              )}
              {!done && s.operation !== "duplicate" && (
                <div className="training-actions">
                  {isEditing ? (
                    <>
                      <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void decide(s, "approve", editPayload(s, editing.draft))}>Ruaj dhe mirato</button>
                      <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setEditing(null)}>Anulo</button>
                    </>
                  ) : (
                    <>
                      {s.status !== "approved" && (s.destination === "gap"
                        ? <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => setEditing({ id: s.id, draft: initialDraft(s) })}>Shkruaj përgjigjen</button>
                        : <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void decide(s, "approve")}>{s.risk === "important" ? "Konfirmo" : "Mirato"}</button>)}
                      {s.destination !== "gap" && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setEditing({ id: s.id, draft: initialDraft(s) })}>Ndrysho</button>}
                      <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void decide(s, "reject")}>Refuzo</button>
                    </>
                  )}
                </div>
              )}
              {s.operation === "duplicate" && s.status === "pending" && (
                <div className="training-actions"><button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void decide(s, "reject")}>Hiqe nga lista</button></div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="training-error" role="alert">{error}</p>}
      {results && (
        <div className="training-results" role="status">
          <b>Çfarë u ruajt</b>
          <ul>{results.map((r, i) => <li key={i} className={r.ok ? "" : "is-failed"}>{r.ok ? "✓" : "✗"} {r.message}</li>)}</ul>
        </div>
      )}
      <div className="training-footer">
        <span>{counts.pending} për t&apos;u vendosur · {counts.approved} të miratuara</span>
        {counts.safe > 0 && <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void act("safe", () => post({ action: "approve_safe", id: sessionId }))}>Mirato të sigurtat ({counts.safe})</button>}
        <button type="button" className="btn btn-primary" disabled={!!busy || !counts.approved} onClick={() => void apply()}>{busy === "apply" ? "Po ruaj…" : `Apliko të miratuarat (${counts.approved})`}</button>
      </div>
    </div>
  );
}
