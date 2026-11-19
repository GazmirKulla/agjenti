"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCustomerQuestions } from "@/lib/items/actions";
import { saveAgentBooking } from "@/lib/calendar/actions";
import { saveHandoffMessage } from "@/lib/agents/handoff-actions";
import { handoffMessageLimit } from "@/lib/agents/communication-policy";
import type { BusinessField } from "@/lib/items/fields";

type Result = { error?: string; success?: string };
const Feedback = ({ result }: { result: Result }) => result.error ? <p className="form-feedback form-feedback-error" role="alert">{result.error}</p>
  : result.success ? <p className="form-feedback" role="status">{result.success}</p> : null;

type Question = { key?: string; label: string; type: BusinessField["type"]; options: string };
const types: Record<BusinessField["type"], string> = { text: "Tekst", number: "Numër", select: "Zgjedhje nga një listë", boolean: "Po / Jo", photo: "Foto nga klienti" };
const toQuestion = (f: BusinessField): Question => ({ key: f.key, label: f.label, type: f.type, options: (f.options ?? []).join(", ") });

/** The questions the agent asks a customer who orders; each product turns on the ones it uses. */
export function CustomerQuestionsEditor({ slug, questions }: { slug: string; questions: BusinessField[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Question[]>(questions.map(toQuestion));
  const [saved, setSaved] = useState(JSON.stringify(questions.map(toQuestion)));
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const update = (i: number, patch: Partial<Question>) => setRows(current => current.map((row, j) => j === i ? { ...row, ...patch } : row));
  const save = () => start(async () => {
    setResult({});
    const payload = rows.map(r => ({ ...(r.key ? { key: r.key } : {}), label: r.label, type: r.type,
      options: r.type === "select" ? r.options.split(/[,;\n]/).map(o => o.trim()).filter(Boolean) : [] }));
    const response = await saveCustomerQuestions(slug, JSON.stringify(payload));
    setResult(response);
    if ("questions" in response && response.questions) { const next = response.questions.map(toQuestion); setRows(next); setSaved(JSON.stringify(next)); router.refresh(); }
  });
  return <div className="grid gap-2">
    {rows.length === 0 && <p className="muted-copy">Asnjë pyetje shtesë: Agjenti pyet vetëm produktin, zgjedhjet e tij dhe të dhënat e klientit.</p>}
    {rows.map((row, i) => (
      <fieldset key={row.key ?? `new-${i}`} className="grid gap-2" style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 10, margin: 0 }}>
        <legend className="sr-only">Pyetja {i + 1}</legend>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1.2fr) 40px", gap: 8 }}>
          <input className="field" aria-label="Pyetja" value={row.label} maxLength={40} placeholder="P.sh. Teksti në bluzë" onChange={e => update(i, { label: e.target.value })} />
          <select className="field" aria-label="Lloji i përgjigjes" value={row.type} onChange={e => update(i, { type: e.target.value as Question["type"] })}>
            {Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button type="button" className="btn btn-ghost" aria-label={`Hiq pyetjen ${row.label || i + 1}`} onClick={() => setRows(current => current.filter((_, j) => j !== i))}>×</button>
        </div>
        {row.type === "select" && <input className="field" aria-label="Vlerat" value={row.options} placeholder="Vlerat, të ndara me presje: p.sh. Dhuratë, E thjeshtë" onChange={e => update(i, { options: e.target.value })} />}
      </fieldset>
    ))}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="btn btn-ghost" disabled={pending || rows.length >= 12} onClick={() => setRows(current => [...current, { label: "", type: "text", options: "" }])}>+ Shto pyetje</button>
      <button type="button" className="btn btn-primary" disabled={pending || JSON.stringify(rows) === saved} onClick={save}>{pending ? "Duke ruajtur…" : "Ruaj pyetjet"}</button>
    </div>
    <Feedback result={result} />
  </div>;
}

/** Whether the agent books by itself, within the calendar's hours. */
export function AgentBookingSwitch({ slug, enabled }: { slug: string; enabled: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const toggle = (next: boolean) => start(async () => {
    setResult({});
    const response = await saveAgentBooking(slug, next, enabled);
    setResult(response);
    if (!response.error) router.refresh();
  });
  return <div className="grid gap-2">
    <label className="toggle-label">
      <span>Agjenti rezervon vetë<small>Sipas orarit të Kalendarit, për shërbimet që pranojnë rezervime. Konfirmon me klientin para çdo rezervimi.</small></span>
      <input className="switch-input" type="checkbox" checked={enabled} disabled={pending} onChange={e => toggle(e.target.checked)} />
    </label>
    <Feedback result={result} />
  </div>;
}

/** What the agent tells the customer when it hands the conversation to staff; saved as a new version. */
export function HandoffMessageForm({ slug, message, updatedAt, fallback }: { slug: string; message: string; updatedAt: string; fallback: string }) {
  const router = useRouter();
  const [value, setValue] = useState(message);
  const [result, setResult] = useState<Result>({});
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    setResult({});
    const response = await saveHandoffMessage(slug, value, updatedAt);
    setResult(response);
    if (!response.error) router.refresh();
  });
  return <div className="grid gap-2">
    <label className="form-label">Çfarë i thotë klientit (opsionale)
      <small className="muted-copy">Bosh: “{fallback}” Agjenti e thotë në gjuhën e bisedës.</small>
      <textarea className="field" rows={2} maxLength={handoffMessageLimit} value={value} disabled={pending} onChange={e => setValue(e.target.value)} />
    </label>
    <div><button type="button" className="btn btn-primary" disabled={pending || value.trim() === message.trim()} onClick={save}>{pending ? "Duke ruajtur…" : "Ruaj mesazhin"}</button></div>
    <Feedback result={result} />
  </div>;
}
