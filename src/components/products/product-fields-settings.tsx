"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProductFields } from "@/lib/items/actions";
import { fieldKey, type BusinessField } from "@/lib/items/fields";
import { missingTemplateFields } from "@/lib/items/field-templates";

type Row = { key?: string; label: string; type: BusinessField["type"]; unit: string; options: string; variant: boolean };
const toRow = (f: BusinessField): Row => ({ key: f.key, label: f.label, type: f.type, unit: f.unit ?? "", options: (f.options ?? []).join(", "), variant: !!f.variant });
const typeLabels: Record<BusinessField["type"], string> = { text: "Tekst", number: "Numër", select: "Listë vlerash", boolean: "Po / Jo" };

/** The owner names the fields their products need: a description (Druri: Ah)
 * or a choice the customer makes (Gjatësia: 80 / 100 / 120 cm). */
type Props = {
  slug: string;
  fields: BusinessField[];
  /** The item kind's own fields (e.g. Marka, Viti for vehicles): always there, not editable here. */
  fixed: { name: string; fields: { key: string; label: string }[] };
  /** The starter fields suggested for the onboarding category. */
  suggested: { category: string | null; fields: BusinessField[] };
  /** Fields the onboarding scan found on the business's own pages, each with the quote that shows it. */
  discovered?: (BusinessField & { evidence: string })[];
};

export function ProductFieldsSettings({ slug, fields, fixed, suggested, discovered = [] }: Props) {
  const [rows, setRows] = useState<Row[]>(fields.map(toRow));
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const fixedKeys = new Set(fixed.fields.flatMap(f => [f.key, fieldKey(f.label)]));
  const missing = missingTemplateFields(suggested.fields, rows.filter(r => r.label.trim()).map(r => ({ key: r.key ?? fieldKey(r.label), label: r.label })));
  // Filtering keeps the same objects, with their quotes.
  const found = missingTemplateFields(discovered, rows.filter(r => r.label.trim()).map(r => ({ key: r.key ?? fieldKey(r.label), label: r.label }))) as typeof discovered;
  const addSuggested = (list: BusinessField[]) => setRows(current => [...current, ...list.map(f => ({ ...toRow(f), key: undefined }))].slice(0, 24));
  const update = (index: number, patch: Partial<Row>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  const save = () => start(async () => {
    setMessage({});
    const payload = rows.map(r => ({ ...(r.key ? { key: r.key } : {}), label: r.label, type: r.variant ? "select" : r.type, unit: r.unit,
      options: r.options.split(/[,;\n]/).map(o => o.trim()).filter(Boolean), variant: r.variant }));
    const result = await saveProductFields(slug, JSON.stringify(payload));
    setMessage(result);
    if ("fields" in result && result.fields) { setRows(result.fields.map(toRow)); router.refresh(); }
  });
  return (
    <section className="panel section-pad grid gap-5" aria-labelledby="product-fields-title">
      <div className="section-title">
        <h2 id="product-fields-title">Fushat e produkteve</h2>
        <button className="btn btn-primary" type="button" onClick={save} disabled={pending}>{pending ? "Duke ruajtur…" : "Ruaj"}</button>
      </div>
      <p className="muted-copy">
        Çdo fushë është një e dhënë që e plotëson te forma e produktit, p.sh. <strong>Druri</strong> ose <strong>Ngjyra</strong>, dhe Agjenti ua tregon klientëve.
        Ndize <strong>Zgjedh klienti</strong> kur klienti zgjedh një vlerë para porosisë (p.sh. Gjatësia 80 / 100 / 120 cm):
        çdo vlerë mund të ketë kodin dhe çmimin e vet te variantet e produktit.
      </p>
      {fixed.fields.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Fushat e gatshme: {fixed.name}</h3>
          <div className="flex flex-wrap gap-2">
            {fixed.fields.map(f => <span key={f.key} className="product-chip">{f.label}</span>)}
          </div>
          <p className="muted-copy">Këto i ka çdo artikull dhe nuk ndryshohen. Më poshtë shton fushat e tua, që dalin pas tyre.</p>
        </div>
      )}
      {found.length > 0 && (
        <div className="grid gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold">Gjetur te faqet e tua</h3>
          <ul className="grid gap-2">
            {found.map(f => (
              <li key={f.key} className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => addSuggested([f])}>
                  + {f.label}{f.unit ? ` (${f.unit})` : ""}{f.variant ? " · zgjedh klienti" : ""}
                </button>
                {f.evidence && <small className="muted-copy">“{f.evidence.length > 120 ? `${f.evidence.slice(0, 119)}…` : f.evidence}”</small>}
              </li>
            ))}
          </ul>
          <span className="muted-copy">Agjenti i gjeti te produktet e skanuara. Shtohen më poshtë; ndryshoji ose hiqi para se të shtypësh Ruaj.</span>
        </div>
      )}
      {missing.length > 0 && (
        <div className="grid gap-2 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold">Fusha të sugjeruara{suggested.category ? ` për ${suggested.category}` : ""}</h3>
          <div className="flex flex-wrap gap-2">
            {missing.map(f => (
              <button key={f.key} type="button" className="btn btn-ghost" onClick={() => addSuggested([f])}
                title={f.variant ? "Zgjedh klienti" : undefined}>
                + {f.label}{f.unit ? ` (${f.unit})` : ""}{f.variant ? " · zgjedh klienti" : ""}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={rows.length >= 24} onClick={() => addSuggested(missing)}>Shto të gjitha ({missing.length})</button>
            <span className="muted-copy">Shtohen më poshtë; ndryshoji ose hiqi para se të shtypësh Ruaj.</span>
          </div>
        </div>
      )}
      {rows.length === 0 && <p className="muted-copy">Ende nuk ke fusha. Shto të parën më poshtë.</p>}
      <div className="grid gap-3">
        {rows.map((row, index) => (
          <fieldset key={row.key ?? `new-${index}`} className="grid gap-3 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <legend className="sr-only">Fusha {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="form-label">
                Emri
                <input className="field" value={row.label} maxLength={40} placeholder="P.sh. Gjatësia" onChange={e => update(index, { label: e.target.value })} />
              </label>
              <label className="form-label">
                Lloji
                <select className="field" value={row.variant ? "select" : row.type} disabled={row.variant} onChange={e => update(index, { type: e.target.value as Row["type"] })}>
                  {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="form-label">
                Njësia (opsionale)
                <input className="field" value={row.unit} maxLength={12} placeholder="P.sh. cm" onChange={e => update(index, { unit: e.target.value })} />
              </label>
            </div>
            {row.label.trim() && fixedKeys.has(fieldKey(row.label)) && (
              <p className="form-feedback form-feedback-error" role="alert">“{row.label.trim()}” është tashmë te fushat e gatshme. Përdor atë ose jepi këtij një emër tjetër.</p>
            )}
            {(row.variant || row.type === "select") && (
              <label className="form-label">
                Vlerat, të ndara me presje{row.variant ? " (opsionale: vlerat e reja shtohen edhe te variantet)" : ""}
                <input className="field" value={row.options} placeholder="P.sh. 80 cm, 100 cm, 120 cm" onChange={e => update(index, { options: e.target.value })} />
              </label>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="toggle-label">
                <span>Zgjedh klienti</span>
                <input className="switch-input" type="checkbox" checked={row.variant} onChange={e => update(index, { variant: e.target.checked })} />
              </label>
              <button type="button" className="btn btn-ghost" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Hiqe</button>
            </div>
          </fieldset>
        ))}
      </div>
      <div>
        <button type="button" className="btn btn-ghost" disabled={rows.length >= 24}
          onClick={() => setRows(current => [...current, { label: "", type: "text", unit: "", options: "", variant: false }])}>+ Shto fushë</button>
      </div>
      {message.error && <p className="form-feedback form-feedback-error" role="alert">{message.error}</p>}
      {message.success && <p className="form-feedback form-feedback-success" role="status">{message.success}</p>}
    </section>
  );
}
