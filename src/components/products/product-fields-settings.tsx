"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProductFields } from "@/lib/items/actions";
import type { BusinessField } from "@/lib/items/fields";

type Row = { key?: string; label: string; type: BusinessField["type"]; unit: string; options: string; variant: boolean };
const toRow = (f: BusinessField): Row => ({ key: f.key, label: f.label, type: f.type, unit: f.unit ?? "", options: (f.options ?? []).join(", "), variant: !!f.variant });
const typeLabels: Record<BusinessField["type"], string> = { text: "Tekst", number: "Numër", select: "Listë vlerash", boolean: "Po / Jo" };

/** The owner names the fields their products need: a description (Druri: Ah)
 * or a choice the customer makes (Gjatësia: 80 / 100 / 120 cm). */
export function ProductFieldsSettings({ slug, fields }: { slug: string; fields: BusinessField[] }) {
  const [rows, setRows] = useState<Row[]>(fields.map(toRow));
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});
  const [pending, start] = useTransition();
  const router = useRouter();
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
        Shto të dhënat që kanë produktet e tua, p.sh. <strong>Druri</strong> ose <strong>Ngjyra</strong>.
        Shëno <strong>Zgjedh klienti</strong> për masat dhe opsionet që ndryshojnë nga një copë te tjetra (p.sh. Gjatësia 80 / 100 / 120 cm):
        çdo vlerë mund të ketë kodin dhe çmimin e vet, dhe agjenti e pyet klientin para porosisë.
      </p>
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
            {(row.variant || row.type === "select") && (
              <label className="form-label">
                Vlerat, të ndara me presje{row.variant ? " (opsionale: vlerat e reja shtohen edhe te variantet)" : ""}
                <input className="field" value={row.options} placeholder="P.sh. 80 cm, 100 cm, 120 cm" onChange={e => update(index, { options: e.target.value })} />
              </label>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="toggle-label">
                <span>Zgjedh klienti (variant me kod dhe çmim)</span>
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
