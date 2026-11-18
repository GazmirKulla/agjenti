"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProductFields } from "@/lib/items/actions";
import { fieldKey, type BusinessField } from "@/lib/items/fields";
import { missingTemplateFields } from "@/lib/items/field-templates";

type Row = { key?: string; label: string; type: BusinessField["type"]; unit: string; options: string; variant: boolean; ask: boolean };
const toRow = (f: BusinessField): Row => ({ key: f.key, label: f.label, type: f.type, unit: f.unit ?? "", options: (f.options ?? []).join(", "), variant: !!f.variant, ask: !!f.ask });
// Who fills the field: the owner on the product, the customer choosing a variant, or the customer answering when ordering.
const roles = { data: "Pronari, te produkti", variant: "Klienti zgjedh (variant)", ask: "Klienti përgjigjet kur porosit" } as const;
const roleOf = (row: Row): keyof typeof roles => row.variant ? "variant" : row.ask ? "ask" : "data";
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
  // What was last saved, to show unsaved changes and keep them from being lost by leaving the page.
  const [saved, setSaved] = useState(() => JSON.stringify(fields.map(toRow)));
  const dirty = JSON.stringify(rows) !== saved;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
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
      options: r.options.split(/[,;\n]/).map(o => o.trim()).filter(Boolean), variant: r.variant, ask: !r.variant && r.ask }));
    const result = await saveProductFields(slug, JSON.stringify(payload));
    setMessage(result);
    if ("fields" in result && result.fields) { const next = result.fields.map(toRow); setRows(next); setSaved(JSON.stringify(next)); router.refresh(); }
  });
  return (
    <section className="panel section-pad grid gap-5" aria-labelledby="product-fields-title">
      <div className="section-title">
        <h2 id="product-fields-title">Fushat e produkteve</h2>
        <button className="btn btn-primary" type="button" onClick={save} disabled={pending}>{pending ? "Duke ruajtur…" : "Ruaj"}</button>
      </div>
      <p className="muted-copy">
        Çdo fushë është një e dhënë që e plotëson te forma e produktit, p.sh. <strong>Druri</strong> ose <strong>Ngjyra</strong>, dhe Agjenti ua tregon klientëve.
        Zgjidh <strong>Klienti zgjedh</strong> kur klienti zgjedh një vlerë para porosisë (p.sh. Gjatësia 80 / 100 / 120 cm):
        çdo vlerë mund të ketë kodin dhe çmimin e vet te variantet e produktit. Zgjidh <strong>Klienti përgjigjet kur porosit</strong>
        për një pyetje që Agjenti i bën klientit, p.sh. <strong>Teksti në bluzë</strong>: te çdo produkt zgjedh nëse e pyet.
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
      <div className="field-rows">
        {rows.length > 0 && (
          <div className="field-rows-head" aria-hidden>
            <span>Emri</span><span>Tipi</span><span>Njësia</span><span>Kush e plotëson</span><span />
          </div>
        )}
        {rows.map((row, index) => (
          <fieldset key={row.key ?? `new-${index}`} className="field-row">
            <legend className="sr-only">Fusha {index + 1}{row.label.trim() ? `: ${row.label.trim()}` : ""}</legend>
            <input className="field" aria-label="Emri" value={row.label} maxLength={40} placeholder="P.sh. Gjatësia" onChange={e => update(index, { label: e.target.value })} />
            <select className="field" aria-label="Tipi" value={row.variant ? "select" : row.type} disabled={row.variant} onChange={e => update(index, { type: e.target.value as Row["type"] })}>
              {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input className="field" aria-label="Njësia (opsionale)" value={row.unit} maxLength={12} placeholder="Njësia, p.sh. cm" onChange={e => update(index, { unit: e.target.value })} />
            <select className="field" aria-label="Kush e plotëson" value={roleOf(row)} onChange={e => update(index, { variant: e.target.value === "variant", ask: e.target.value === "ask" })}>
              {Object.entries(roles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className="btn btn-ghost field-row-remove" aria-label={`Hiq fushën ${row.label.trim() || index + 1}`} title="Hiqe"
              onClick={() => setRows(current => current.filter((_, i) => i !== index))}>×</button>
            {(row.variant || row.type === "select") && (
              <label className="form-label field-row-options">
                Vlerat, të ndara me presje{row.variant ? " (opsionale: vlerat e reja shtohen edhe te variantet)" : ""}
                <input className="field" value={row.options} placeholder="P.sh. 80 cm, 100 cm, 120 cm" onChange={e => update(index, { options: e.target.value })} />
              </label>
            )}
            {row.label.trim() && fixedKeys.has(fieldKey(row.label)) && (
              <p className="form-feedback form-feedback-error field-row-options" role="alert">“{row.label.trim()}” është tashmë te fushat e gatshme. Përdor atë ose jepi këtij një emër tjetër.</p>
            )}
          </fieldset>
        ))}
      </div>
      <div>
        <button type="button" className="btn btn-ghost" disabled={rows.length >= 24}
          onClick={() => setRows(current => [...current, { label: "", type: "text", unit: "", options: "", variant: false, ask: false }])}>+ Shto fushë</button>
      </div>
      {message.error && <p className="form-feedback form-feedback-error" role="alert">{message.error}</p>}
      {message.success && <p className="form-feedback form-feedback-success" role="status">{message.success}</p>}
      {dirty && (
        <div className="unsaved-bar" role="status">
          <span>Ke ndryshime të paruajtura te fushat.</span>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { setRows(JSON.parse(saved)); setMessage({}); }}>Anulo</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{pending ? "Duke ruajtur…" : "Ruaj fushat"}</button>
        </div>
      )}
    </section>
  );
}
