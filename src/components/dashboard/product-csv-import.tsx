"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { productCsvConfiguration, confirmProductCsv, evaluateProductCsv, reviewProductCsv, uploadProductCsv } from "@/lib/products/csv-import-actions";
import { configurationLabels, importFields, importLabels, type ImportOptions, type ImportPreview, type ImportSource } from "@/lib/products/import-model";
import { FileCard } from "@/components/business-assistant/file-card";
import { Icon } from "./icon";
import { ProductCsvDialog } from "./product-csv-dialog";
import { ProductCsvResult } from "./product-csv-result";
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
  const [saved, setSaved] = useState<string>();
  const [detail, setDetail] = useState<"settings" | "review" | null>(null);
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
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
      setDetail(null);
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
    <header className="csv-file-header">
      {source ? <FileCard item={{ name: source.name }} detail={`CSV · ${source.count} rreshta · ${source.headers.length} kolona`} action={!saved && <div className="csv-file-actions"><button type="button" className="attachment-remove" aria-label="Përshtat kolonat dhe importin" title="Përshtat kolonat dhe importin" disabled={busy} onClick={() => setDetail("settings")}><Icon name="settings" size={17}/></button><button type="button" className="attachment-remove" disabled={busy} aria-label="Zëvendëso CSV-në" title="Zëvendëso CSV-në" onClick={() => fileInput.current?.click()}><Icon name="refresh" size={18}/></button></div>}/> : <button type="button" className="csv-upload" disabled={busy} onClick={() => fileInput.current?.click()}><span className="attachment-icon is-sheet"><Icon name="file" size={24}/></span><span><strong>Ngarko skedarin CSV</strong><small>Zgjidh një skedar · Deri në 500 KB</small></span><Icon name="plus" size={20}/></button>}
      <input ref={fileInput} hidden disabled={busy} type="file" accept=".csv,text/csv" onChange={e => {
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
    }}/>
    </header>
    {source && !preview && <div className="csv-ready">
      <p>Gati për vlerësim</p>
      <small>Agjenti kontrollon skedarin dhe e krahason me produktet ekzistuese.</small>
      <button type="button" className="btn btn-primary csv-main-action" disabled={busy || !selected.length} onClick={() => void review(true)}><Icon name="spark" size={16}/> Vlerëso me Agjentin</button>
      <small>Përmbajtja analizohet nga AI. Ndryshimet ruhen vetëm me miratimin tënd.</small>
    </div>}
    {busy && <p className="csv-progress" role="status"><span className="csv-spinner"/> Duke përpunuar…</p>}
    {preview && <ProductCsvResult preview={preview} saved={saved} slug={slug} busy={busy} onDetails={() => setDetail("review")} onNew={() => { setSaved(undefined); setPreview(undefined); setSource(undefined); setCsvText(""); setNotice(""); setWithoutHeaders(false); setOptions({ mapping: {}, fields: [...importFields] }); }}/>}
    {!source && <button type="button" className="csv-text-button" onClick={() => setDetail("settings")}>Ngjit tekst ose përshtat CSV-në</button>}
    {detail === "settings" && <ProductCsvDialog title="Përshtat importin" onClose={() => setDetail(null)} footer={<button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>U krye</button>}>
    <div className="csv-source-options">
      <label><input type="checkbox" disabled={busy} checked={withoutHeaders} onChange={e => { setWithoutHeaders(e.target.checked); setPreview(undefined); setSource(undefined); }}/> CSV pa tituj kolonash (emër, çmim, monedhë, përshkrim, SKU, foto)</label>
    <details><summary>Ngjit ose korrigjo tekstin CSV</summary>
      <label>Teksti CSV<textarea className="field" rows={6} value={csvText} disabled={busy} onChange={e => { setCsvText(e.target.value); setPreview(undefined); setSource(undefined); }} placeholder="emri,sku,cmimi,monedha" /></label>
      <button type="button" className="btn btn-ghost" disabled={busy || !csvText.trim()} onClick={() => void run(async () => {
        setPreview(undefined); setSource(undefined);
        const result = await uploadProductCsv(slug, csvText, "Produkte.csv", withoutHeaders);
        if (result.error) { setNotice(result.error); return; }
        setSource(result.source); setOptions({ mapping: result.source!.mapping, fields: [...importFields] });
      })}>Lexo CSV-në</button>
    </details>
    </div>
      {source && <>
      <div className="csv-customize-body">
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
      </div>
        <div className="csv-buttons"><button type="button" className="btn btn-ghost" disabled={busy || !selected.length} onClick={() => void review(false)}>Krahaso pa AI</button>
          <button type="button" className="btn btn-ghost" disabled={busy || !selected.length} onClick={() => void review(true)}>Vlerëso me Agjentin</button>
        </div>
      </>}
      {busy && <p role="status">Duke përpunuar…</p>}
      {notice && <p role="alert">{notice}</p>}
    </ProductCsvDialog>}
    {detail === "review" && preview && <ProductCsvDialog title={saved ? "Ndryshimet e ruajtura" : "Rishiko importin"} onClose={() => setDetail(null)} footer={saved || !changes ? <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>Mbyll</button> : (
      <div className="csv-approval"><small>Asnjë ndryshim nuk është ruajtur ende.</small><button type="button" className="btn btn-primary" disabled={busy || !preview.token || preview.rows.some(row => row.status === "conflict")} onClick={() => void run(async () => {
        const result = await confirmProductCsv(slug, preview.token!);
        setNotice("error" in result ? result.error : result.success);
        if ("success" in result) { setSaved(result.success); setNotice(""); setDetail(null); router.refresh(); }
      })}>{busy ? "Duke punuar…" : `Mirato dhe ruaj (${changes})`}</button></div>
    )}>
      {source && <p className="csv-dialog-filename">{source.name}</p>}
      {saved && <p role="status">{saved}</p>}
      <div className="csv-summary" aria-label="Përmbledhja e ndryshimeve">{([
        ["create", "të reja"], ["update", "përditësime"], ["unchanged", "pa ndryshim"], ["conflict", "konflikte"],
      ] as const).map(([status, label]) => {
        const count = preview.rows.filter(row => row.status === status).length;
        return count ? <span key={status} data-conflict={status === "conflict"}>{count} {label}</span> : null;
      })}</div>
      <div className="csv-results" tabIndex={0} role="region" aria-label="Detajet e ndryshimeve">{preview.rows.map(row => <details key={row.line} open={row.status === "conflict"}>
        <summary><span className="csv-row-number">{row.line}</span><span className="csv-row-name">{row.name}</span><span className={`csv-row-status is-${row.status}`}>{{ create: "Shtim", update: "Përditësim", unchanged: "Pa ndryshim", conflict: "Konflikt" }[row.status]}</span></summary>
        {row.errors.map(s => <p role="alert" key={s}>{s}</p>)}{row.warnings.map(s => <p key={s}>{s}</p>)}
        <dl>{Object.entries(row.patch).map(([field, value]) => <div key={field}><dt>{({ ...importLabels, ...configurationLabels })[field as keyof typeof importLabels]}</dt><dd><span>{display(field, row.before?.[field as keyof typeof row.before])}</span> → <strong>{display(field, value)}</strong></dd></div>)}</dl>
      </details>)}</div>
      {preview.advice && <details className="csv-ai-review"><summary><Icon name="spark" size={16}/> Vlerësimi i Agjentit</summary><p className="csv-advice">{preview.advice}</p></details>}
      {preview.rows.some(r => r.status === "conflict") && <p role="alert">Korrigjo CSV-në ose hiq rreshtat me konflikt dhe vlerëso përsëri. Ende nuk është ruajtur asgjë.</p>}
      {!saved && <button type="button" className="csv-text-button" disabled={busy} onClick={() => setDetail("settings")}>Përshtat kolonat dhe importin</button>}
      {notice && <p role="alert">{notice}</p>}
    </ProductCsvDialog>}
    {notice && !detail && <p role="status">{notice}</p>}
  </section>;
}
