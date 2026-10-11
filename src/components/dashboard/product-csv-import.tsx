"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { productCsvConfiguration, confirmProductCsv, evaluateProductCsv, reviewProductCsv, uploadProductCsv } from "@/lib/products/csv-import-actions";
import { configurationLabels, importFields, importLabels, type ImportOptions, type ImportPreview, type ImportSource } from "@/lib/products/import-model";
import "./product-csv-import.css";

export function ProductCsvImport({ slug, initialSource }: { slug: string; initialSource?: ImportSource }) {
  const router = useRouter();
  const [withoutHeaders, setWithoutHeaders] = useState(false);
  const [csvText, setCsvText] = useState(initialSource?.raw ?? "");
  const [source, setSource] = useState(initialSource);
  const [options, setOptions] = useState<ImportOptions>({ mapping: initialSource?.mapping ?? {}, fields: initialSource?.fields ?? [...importFields] });
  const [preview, setPreview] = useState<ImportPreview>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const [configuration, setConfiguration] = useState<{ types: {id:string;name:string}[]; workflows: {id:string;name:string}[] }>({ types: [], workflows: [] });
  useEffect(() => {
    let cancelled = false;
    void productCsvConfiguration(slug).then(result => {
      if (!cancelled && "types" in result && result.types && result.workflows) setConfiguration({ types: result.types, workflows: result.workflows });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    try { await work(); } catch { setNotice("Veprimi nuk përfundoi. Provo përsëri."); }
    finally { lock.current = false; setBusy(false); }
  }
  function change(next: ImportOptions) { setOptions(next); setPreview(undefined); setNotice(""); }
  async function review(ai: boolean) {
    if (!source) return;
    await run(async () => {
      const result = ai ? await evaluateProductCsv(slug, source.token, options) : await reviewProductCsv(slug, source.token, options);
      if (result.error) { setNotice(result.error); setPreview(undefined); return; }
      if ("mapping" in result && result.mapping) setOptions(o => ({ ...o, mapping: result.mapping! }));
      setPreview(result.preview);
    });
  }
  function display(field: string, value: unknown) {
    if (field === "product_type_id") return configuration.types.find(t => t.id === value)?.name ?? (value ? "Lloj ekzistues" : "—");
    if (field === "workflow_id") return configuration.workflows.find(t => t.id === value)?.name ?? (value ? "Workflow ekzistues" : "Kryesori / pa konfigurim të veçantë");
    return String(value ?? "—");
  }
  const allLines = Array.from({ length: source?.count ?? 0 }, (_, i) => i + 2);
  const selected = options.lines ?? allLines;
  const changes = preview?.rows.filter(r => r.status === "create" || r.status === "update").length ?? 0;
  return <section className="csv-import" aria-label="Vlerësimi i importit CSV" aria-busy={busy}>
    <label><input type="checkbox" disabled={busy} checked={withoutHeaders} onChange={e => { setWithoutHeaders(e.target.checked); setPreview(undefined); setSource(undefined); }}/> CSV pa tituj kolonash (emër, çmim, monedhë, përshkrim, SKU, foto)</label>
    <label className="btn btn-ghost">{source ? "Zëvendëso CSV-në" : "Zgjidh CSV"}<input disabled={busy} className="sr-only" type="file" accept=".csv,text/csv" onChange={e => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (!file) return;
      // Invalidate approval immediately, including when the replacement file is invalid.
      setSource(undefined); setPreview(undefined);
      void run(async () => {
        if (file.size > 512000) { setNotice("CSV-ja duhet të jetë deri në 500 KB."); return; }
        const raw = await file.text(); setCsvText(raw);
        const result = await uploadProductCsv(slug, raw, file.name, withoutHeaders);
        if (result.error) { setNotice(result.error); return; }
        setSource(result.source); setOptions({ mapping: result.source!.mapping, fields: [...importFields] });
      });
    }}/></label>
    <details><summary>Ngjit ose korrigjo tekstin CSV</summary>
      <label>Teksti CSV<textarea className="field" rows={6} value={csvText} disabled={busy} onChange={e => { setCsvText(e.target.value); setPreview(undefined); setSource(undefined); }} placeholder="emri,sku,cmimi,monedha" /></label>
      <button type="button" className="btn btn-ghost" disabled={busy || !csvText.trim()} onClick={() => void run(async () => {
        setPreview(undefined); setSource(undefined);
        const result = await uploadProductCsv(slug, csvText, "Produkte.csv", withoutHeaders);
        if (result.error) { setNotice(result.error); return; }
        setSource(result.source); setOptions({ mapping: result.source!.mapping, fields: [...importFields] });
      })}>Lexo CSV-në</button>
    </details>
    {source && <>
      <p><strong>{source.name}</strong> · {source.count} rreshta</p>
      {source.headers.some((_, i) => !options.fields.some(f => options.mapping[f] === i)) && <p className="muted-copy">Kolona jashtë ndryshimeve: {source.headers.filter((_, i) => !options.fields.some(f => options.mapping[f] === i)).join(", ")}.</p>}
      <p className="muted-copy">Lidh kolonat dhe zgjidh fushat. Kolonat që mungojnë dhe qelizat bosh ruajnë vlerat ekzistuese. Produktet e reja krijohen draft.</p>
      <fieldset disabled={busy} className="csv-mapping"><legend>Kolonat dhe fushat për import</legend>{importFields.map(f => <div key={f}>
        <label><input type="checkbox" checked={options.fields.includes(f)} onChange={e => change({ ...options, fields: e.target.checked ? [...options.fields, f] : options.fields.filter(k => k !== f) })}/> {importLabels[f]}</label>
        <select className="field" aria-label={`Kolona për ${importLabels[f]}`} value={options.mapping[f] ?? ""} onChange={e => {
          const mapping = { ...options.mapping }; if (e.target.value === "") delete mapping[f]; else mapping[f] = Number(e.target.value);
          change({ ...options, mapping });
        }}><option value="">Pa kolonë</option>{source.headers.map((h, i) => <option value={i} key={i}>{h}</option>)}</select>
      </div>)}</fieldset>
      <fieldset className="csv-mapping" disabled={busy}><legend>Konfigurimi (opsional)</legend>
        <label>Lloji i produktit<select className="field" value={options.productTypeId ?? ""} onChange={e => change({ ...options, productTypeId: e.target.value || undefined })}><option value="">Ruaj konfigurimin ekzistues</option>{configuration.types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Workflow i porosisë<select className="field" value={options.workflowId ?? ""} onChange={e => change({ ...options, workflowId: e.target.value || undefined })}><option value="">Ruaj konfigurimin / workflow kryesor</option>{configuration.workflows.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      </fieldset>
      <div className="csv-buttons"><button type="button" disabled={busy} className="btn btn-ghost" onClick={() => change({ ...options, fields: ["price_amount", "currency"] })}>Vetëm çmimet</button>
      <button type="button" disabled={busy} className="btn btn-ghost" onClick={() => change({ ...options, fields: [...importFields] })}>Të gjitha fushat</button></div>
      <details><summary>Zgjidh rreshtat ({selected.length}/{source.count})</summary><fieldset disabled={busy} className="csv-lines"><legend>Rreshtat e CSV-së</legend>
        <label><input type="checkbox" checked={selected.length === allLines.length} onChange={e => change({ ...options, lines: e.target.checked ? allLines : [] })}/> Të gjithë</label>
        {allLines.map(n => <label key={n}><input type="checkbox" checked={selected.includes(n)} onChange={e => change({ ...options, lines: e.target.checked ? [...selected, n] : selected.filter(l => l !== n) })}/> Rreshti {n}</label>)}
      </fieldset></details>
      <div className="csv-buttons"><button type="button" className="btn btn-ghost" disabled={busy || !selected.length} onClick={() => void review(false)}>Krahaso me katalogun</button>
      <button type="button" className="btn btn-primary" disabled={busy || !selected.length} onClick={() => void review(true)}>Vlerëso me Agjentin</button></div>
      <small className="muted-copy">Vlerësimi me Agjentin dërgon përmbajtjen e CSV-së te AI për analizë. Ruajtja bëhet vetëm pas miratimit.</small>
    </>}
    {preview && <section aria-label="Ndryshimet e propozuara">
      {preview.advice && <p className="csv-advice">{preview.advice}</p>}
      <h3>{changes} ndryshime · {preview.rows.filter(r => r.status === "unchanged").length} pa ndryshim · {preview.rows.filter(r => r.status === "conflict").length} konflikte</h3>
      <div className="csv-results">{preview.rows.map(row => <details key={row.line} open={row.status === "conflict"}>
        <summary>Rreshti {row.line} · {row.name} · {{ create: "Shtim", update: "Përditësim", unchanged: "Pa ndryshim", conflict: "Konflikt" }[row.status]}</summary>
        {row.errors.map(s => <p role="alert" key={s}>{s}</p>)}{row.warnings.map(s => <p key={s}>{s}</p>)}
        <dl>{Object.entries(row.patch).map(([field, value]) => <div key={field}><dt>{({ ...importLabels, ...configurationLabels })[field as keyof typeof importLabels]}</dt><dd><span>{display(field, row.before?.[field as keyof typeof row.before])}</span> → <strong>{display(field, value)}</strong></dd></div>)}</dl>
      </details>)}</div>
      {preview.rows.some(r => r.status === "conflict") && <p role="alert">Korrigjo CSV-në ose hiq rreshtat me konflikt dhe vlerëso përsëri. Ende nuk është ruajtur asgjë.</p>}
      <button type="button" className="btn btn-primary" disabled={busy || !preview.token} onClick={() => void run(async () => {
        const result = await confirmProductCsv(slug, preview.token!);
        setNotice("error" in result ? result.error : result.success);
        if ("success" in result) { setPreview(undefined); setSource(undefined); router.refresh(); }
      })}>{busy ? "Duke punuar…" : `Mirato ${changes} ndryshimet`}</button>
    </section>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
