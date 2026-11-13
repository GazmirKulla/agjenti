"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { productCsvConfiguration, confirmProductCsv, evaluateProductCsv, reviewProductCsv, uploadProductCsv, acceptProductCsvPlan } from "@/lib/products/csv-import-actions";
import { autoMapAttributes, configurationLabels, importFields, importLabels, importValueLabel, readImportCsv, type ImportOptions, type ImportPreview, type ImportSource } from "@/lib/products/import-model";
import { columnChoice, describePlan, editPlanColumn, planNewFields, type ImportPlan } from "@/lib/products/import-plan";
import { saveProductFields } from "@/lib/items/actions";
import type { BusinessField } from "@/lib/items/fields";
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
  const [options, setOptions] = useState<ImportOptions>(initialSource?.options ? { ...initialSource.options, fields: initialSource.fields ?? initialSource.options.fields } : { mapping: initialSource?.mapping ?? {}, fields: initialSource?.fields ?? [...importFields] });
  // The reading plan: proposed by the Agent and waiting for the owner, or approved (now or for earlier files with the same titles).
  const [plan, setPlan] = useState<{ plan: ImportPlan; advice?: string; state: "proposed" | "saved" } | undefined>(
    initialSource?.plan ? { plan: initialSource.plan, state: "saved" } : undefined);
  const [preview, setPreview] = useState<ImportPreview>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<string>();
  const [detail, setDetail] = useState<"settings" | "review" | null>(null);
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [configuration, setConfiguration] = useState<{ types: {id:string;name:string}[]; workflows: {id:string;name:string}[]; fields: BusinessField[] }>({ types: [], workflows: [], fields: [] });
  useEffect(() => {
    let cancelled = false;
    void productCsvConfiguration(slug).then(result => {
      if (!cancelled && "types" in result && result.types && result.workflows) setConfiguration({ types: result.types, workflows: result.workflows, fields: result.fields ?? [] });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);
  // Columns named like one of the business's own fields (e.g. "Gjatësia") are linked to it.
  const sourceToken = source?.token, sourceHeaders = source?.headers;
  useEffect(() => {
    if (!sourceHeaders || !configuration.fields.length) return;
    setOptions(o => {
      const attributes = autoMapAttributes(sourceHeaders, configuration.fields, Object.values(o.mapping).filter((n): n is number => n !== undefined), o.attributes);
      return JSON.stringify(attributes) === JSON.stringify(o.attributes ?? {}) ? o : { ...o, attributes };
    });
  }, [sourceToken, sourceHeaders, configuration.fields]);
  const fieldLabels = Object.fromEntries(configuration.fields.map(f => [f.key, f.label]));
  // The plan's sentences are worked out here from the file, so they follow every change the owner makes.
  const cells = useMemo(() => { try { return source ? readImportCsv(source.raw).cells : []; } catch { return []; } }, [source]);
  const planLines = plan ? describePlan(plan.plan, cells, configuration.fields) : [];
  const newFields = plan ? planNewFields(plan.plan) : [];
  const editColumn = (index: number, change: Parameters<typeof editPlanColumn>[2]) =>
    setPlan(p => p && { ...p, plan: editPlanColumn(p.plan, index, change, configuration.fields) });
  const usedColumns = new Set([...options.fields.flatMap(f => options.mapping[f] === undefined ? [] : [options.mapping[f]!]), ...Object.values(options.attributes ?? {})]);
  const unmapped = source?.headers.flatMap((h, i) => usedColumns.has(i) ? [] : [{ header: h, index: i }]) ?? [];
  async function addField(header: string, index: number, variant: boolean) {
    await run(async () => {
      const result = await saveProductFields(slug, JSON.stringify([...configuration.fields, { label: header.slice(0, 40), type: "text", variant }]));
      if ("error" in result) { setNotice(result.error ?? ""); return; }
      const fields = result.fields ?? [];
      const added = fields.find(f => !configuration.fields.some(old => old.key === f.key));
      setConfiguration(c => ({ ...c, fields }));
      if (added) change({ ...options, attributes: { ...(options.attributes ?? {}), [added.key]: index } });
    });
  }
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    try { await work(); } catch { setNotice("Veprimi nuk përfundoi. Provo përsëri."); }
    finally { lock.current = false; setBusy(false); }
  }
  function change(next: ImportOptions) { setOptions(next); setPreview(undefined); setNotice(""); }
  function opened(result: { source?: ImportSource; planLines?: string[] }) {
    const next = result.source!;
    setSource(next);
    setOptions(next.options ? { ...next.options, fields: [...importFields] } : { mapping: next.mapping, fields: [...importFields] });
    setPlan(next.plan ? { plan: next.plan, state: "saved" } : undefined);
  }
  async function review(ai: boolean) {
    if (!source) return;
    await run(async () => {
      if (ai) {
        const result = await evaluateProductCsv(slug, source.token, options);
        if (result.error || !result.plan) { setNotice(result.error ?? "Agjenti nuk ktheu plan. Provo përsëri."); setPreview(undefined); return; }
        // The owner reads the plan first; the rows are compared once it is approved.
        setPlan({ plan: result.plan, advice: result.preview?.advice, state: "proposed" });
        setPreview(undefined); setDetail(null);
        return;
      }
      const result = await reviewProductCsv(slug, source.token, options);
      if (result.error) { setNotice(result.error); setPreview(undefined); return; }
      setPreview(result.preview);
      setDetail(null);
    });
  }
  async function acceptPlan() {
    if (!source || !plan) return;
    await run(async () => {
      const result = await acceptProductCsvPlan(slug, source.token, plan.plan, options);
      if ("error" in result) { setNotice(result.error ?? ""); return; }
      setConfiguration(c => ({ ...c, fields: result.fields }));
      setOptions(result.options);
      setPlan(p => p && { ...p, plan: result.plan, state: "saved" });
      setPreview({ ...result.preview, advice: plan.advice });
    });
  }
  function downloadTemplate() {
    // Our columns and the business's own fields; a file with these titles is read without the Agent.
    const titles = [...importFields.map(f => importLabels[f]), ...configuration.fields.map(f => f.label)];
    const example = ["Produkt shembull", "KOD-1", "1000", "", "", "ALL", "Përshkrimi i produktit", "", ...configuration.fields.map(f => f.variant ? "Vlera 1; Vlera 2" : "")];
    const cell = (v: string) => /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const blob = new Blob(["\uFEFF" + [titles, example].map(row => row.map(cell).join(",")).join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "shablloni-produktet.csv"; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  function display(field: string, value: unknown) {
    if (field === "product_type_id") return configuration.types.find(t => t.id === value)?.name ?? (value ? "Lloj ekzistues" : "—");
    if (field === "workflow_id") return configuration.workflows.find(t => t.id === value)?.name ?? (value ? "Workflow ekzistues" : "Kryesori / pa konfigurim të veçantë");
    if (Array.isArray(value)) return value.join(", ");
    return String(importValueLabel(field, value) ?? "—");
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
      setSource(undefined); setPreview(undefined); setPlan(undefined);
      void run(async () => {
        if (file.size > 512000) { setNotice("CSV-ja duhet të jetë deri në 500 KB."); return; }
        const raw = await file.text(); setCsvText(raw);
        const result = await uploadProductCsv(slug, raw, file.name, withoutHeaders);
        if (result.error) { setNotice(result.error); return; }
        opened(result);
      });
    }}/>
    </header>
    {source && !preview && plan?.state === "proposed" && <div className="csv-plan" aria-label="Plani i leximit">
      <p className="csv-plan-title"><Icon name="spark" size={16}/> <strong>Plani i leximit</strong></p>
      <p className="muted-copy">Agjenti propozon si të lexohet çdo kolonë. Rishikoje: asgjë nuk ruhet në katalog pa miratimin tënd të rreshtave.</p>
      <ol className="csv-plan-columns">{plan.plan.columns.map((column, i) => {
        const choice = columnChoice(column);
        return <li key={column.index}>
          <p>{planLines[i]}</p>
          <div className="csv-plan-edit">
            <select className="field" aria-label={`Si lexohet “${column.header}”`} disabled={busy} value={choice} onChange={e => editColumn(column.index, { choice: e.target.value })}>
              {importFields.map(f => <option key={f} value={f}>{importLabels[f]}</option>)}
              {configuration.fields.map(f => <option key={f.key} value={`key:${f.key}`}>Fusha “{f.label}”{f.variant ? " (zgjedh klienti)" : ""}</option>)}
              <option value="new:choice">Fushë e re që zgjedh klienti</option>
              <option value="new:field">Fushë e re përshkruese</option>
              <option value="ignore">Mos e importo</option>
            </select>
            {choice.startsWith("new:") && <>
              <input className="field" aria-label={`Emri i fushës për “${column.header}”`} maxLength={40} disabled={busy} value={column.label ?? ""} onChange={e => editColumn(column.index, { label: e.target.value })}/>
              <input className="field csv-plan-unit" aria-label={`Njësia për “${column.header}”`} placeholder="Njësia" maxLength={12} disabled={busy} value={column.unit ?? ""} onChange={e => editColumn(column.index, { unit: e.target.value })}/>
            </>}
          </div>
        </li>;
      })}</ol>
      {plan.plan.columns.some(c => c.use === "price_amount") && <label className="csv-plan-request"><input type="checkbox" disabled={busy} checked={plan.plan.missingPrice === "request"}
        onChange={e => setPlan(p => p && { ...p, plan: { ...p.plan, missingPrice: e.target.checked ? "request" : "empty" } })}/> Rreshtat pa asnjë çmim ruhen “Sipas kërkesës”</label>}
      {newFields.length > 0 && <p className="muted-copy">Shtohen fushat e produkteve: {newFields.map(f => `“${f.label}”${f.unit ? ` (${f.unit})` : ""}`).join(", ")}.</p>}
      {plan.advice && <details className="csv-ai-review"><summary>Vlerësimi i Agjentit</summary><p className="csv-advice">{plan.advice}</p></details>}
      <div className="csv-buttons">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void acceptPlan()}>Prano propozimet</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setPlan(undefined); setDetail("settings"); }}>Lidh kolonat vetë</button>
      </div>
    </div>}
    {source && !preview && plan?.state === "saved" && <div className="csv-ready">
      <p>Kjo CSV lexohet sipas planit që ke miratuar</p>
      {planLines.length > 0 && <details><summary>Si lexohen kolonat</summary><ul className="csv-plan-lines">{planLines.map(line => <li key={line}>{line}</li>)}</ul></details>}
      <button type="button" className="btn btn-primary csv-main-action" disabled={busy || !selected.length} onClick={() => void review(false)}>Krahaso me katalogun</button>
      <button type="button" className="csv-text-button" disabled={busy} onClick={() => void review(true)}>Lexoje përsëri me Agjentin</button>
    </div>}
    {source && !preview && !plan && <div className="csv-ready">
      <p>Gati për vlerësim</p>
      {unmapped.length > 0 && <p className="muted-copy">Kolonat {unmapped.map(u => `“${u.header}”`).join(", ")} nuk kanë ende vend. <button type="button" className="csv-text-button" onClick={() => setDetail("settings")}>Shtoji si fusha</button></p>}
      <small>Agjenti kontrollon skedarin dhe e krahason me produktet ekzistuese.</small>
      <button type="button" className="btn btn-primary csv-main-action" disabled={busy || !selected.length} onClick={() => void review(true)}><Icon name="spark" size={16}/> Vlerëso me Agjentin</button>
      <small>Përmbajtja analizohet nga AI. Ndryshimet ruhen vetëm me miratimin tënd.</small>
    </div>}
    {busy && <p className="csv-progress" role="status"><span className="csv-spinner"/> Duke përpunuar…</p>}
    {preview && <ProductCsvResult preview={preview} saved={saved} slug={slug} busy={busy} onDetails={() => setDetail("review")} onNew={() => { setSaved(undefined); setPreview(undefined); setSource(undefined); setPlan(undefined); setCsvText(""); setNotice(""); setWithoutHeaders(false); setOptions({ mapping: {}, fields: [...importFields] }); }}/>}
    {!source && <div className="csv-buttons"><button type="button" className="csv-text-button" onClick={() => setDetail("settings")}>Ngjit tekst ose përshtat CSV-në</button>
      <button type="button" className="csv-text-button" onClick={downloadTemplate}>Shkarko shabllonin</button></div>}
    {detail === "settings" && <ProductCsvDialog title="Përshtat importin" onClose={() => setDetail(null)} footer={<button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>U krye</button>}>
    <div className="csv-source-options">
      <label><input type="checkbox" disabled={busy} checked={withoutHeaders} onChange={e => { setWithoutHeaders(e.target.checked); setPreview(undefined); setSource(undefined); }}/> CSV pa tituj kolonash (emër, çmim, monedhë, përshkrim, SKU, foto)</label>
    <details><summary>Ngjit ose korrigjo tekstin CSV</summary>
      <label>Teksti CSV<textarea className="field" rows={6} value={csvText} disabled={busy} onChange={e => { setCsvText(e.target.value); setPreview(undefined); setSource(undefined); }} placeholder="emri,sku,cmimi,monedha" /></label>
      <button type="button" className="btn btn-ghost" disabled={busy || !csvText.trim()} onClick={() => void run(async () => {
        setPreview(undefined); setSource(undefined);
        const result = await uploadProductCsv(slug, csvText, "Produkte.csv", withoutHeaders);
        if (result.error) { setNotice(result.error); return; }
        opened(result);
      })}>Lexo CSV-në</button>
    </details>
    </div>
      {source && <>
      <div className="csv-customize-body">
      {unmapped.length > 0 && <div className="csv-unmapped">
        <p className="muted-copy">Kolona pa vend: {unmapped.map(u => u.header).join(", ")}. Shtoji si fusha të produkteve që të mos humbasin. <strong>Variant</strong> është ajo që zgjedh klienti (p.sh. gjatësia): rreshtat me të njëjtin emër bëhen një produkt me disa variante.</p>
        {unmapped.map(u => <div key={u.index} className="csv-buttons">
          <span>{u.header}</span>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void addField(u.header, u.index, false)}>Shto si të dhënë</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void addField(u.header, u.index, true)}>Shto si variant</button>
        </div>)}
      </div>}
      <p className="muted-copy">Lidh kolonat dhe zgjidh fushat. Kolonat që mungojnë dhe qelizat bosh ruajnë vlerat ekzistuese. Produktet e reja krijohen draft.</p>
      <fieldset disabled={busy} className="csv-mapping"><legend>Kolonat dhe fushat për import</legend>{importFields.map(f => <div key={f}>
        <label><input type="checkbox" checked={options.fields.includes(f)} onChange={e => change({ ...options, fields: e.target.checked ? [...options.fields, f] : options.fields.filter(k => k !== f) })}/> {importLabels[f]}</label>
        <select className="field" aria-label={`Kolona për ${importLabels[f]}`} value={options.mapping[f] ?? ""} onChange={e => {
          const mapping = { ...options.mapping }; if (e.target.value === "") delete mapping[f]; else mapping[f] = Number(e.target.value);
          change({ ...options, mapping });
        }}><option value="">Pa kolonë</option>{source.headers.map((h, i) => <option value={i} key={i}>{h}</option>)}</select>
      </div>)}</fieldset>
      {configuration.fields.length > 0 && <fieldset disabled={busy} className="csv-mapping"><legend>Fushat e produkteve të tua</legend>{configuration.fields.map(f => <div key={f.key}>
        <span>{f.label}{f.variant ? " (variant)" : ""}</span>
        <select className="field" aria-label={`Kolona për ${f.label}`} value={options.attributes?.[f.key] ?? ""} onChange={e => {
          const attributes = { ...(options.attributes ?? {}) }; if (e.target.value === "") delete attributes[f.key]; else attributes[f.key] = Number(e.target.value);
          change({ ...options, attributes });
        }}><option value="">Pa kolonë</option>{source.headers.map((h, i) => <option value={i} key={i}>{h}</option>)}</select>
      </div>)}</fieldset>}
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
        {/* A value that stays empty (e.g. no price for a price on request) is not a change worth a line. */}
        <dl>{Object.entries(row.patch).filter(([field, value]) => value != null || row.before?.[field as keyof typeof row.before] != null).flatMap(([field, value]) => field === "attributes" && value && typeof value === "object"
          ? Object.entries(value).map(([key, item]) => <div key={`a-${key}`}><dt>{fieldLabels[key] ?? key}</dt><dd><span>{display(key, row.before?.attributes?.[key])}</span> → <strong>{display(key, item)}</strong></dd></div>)
          : [<div key={field}><dt>{({ ...importLabels, ...configurationLabels })[field as keyof typeof importLabels]}</dt><dd><span>{display(field, row.before?.[field as keyof typeof row.before])}</span> → <strong>{display(field, value)}</strong></dd></div>])}
          {row.variants?.map(v => <div key={JSON.stringify(v.options)}><dt>Variant</dt><dd><strong>{Object.entries(v.options).map(([k, val]) => `${fieldLabels[k] ?? k}: ${val}`).join(" · ")}</strong>{v.sku ? ` · ${v.sku}` : ""}{v.price_amount !== null ? ` · ${v.price_amount}` : ""}</dd></div>)}</dl>
      </details>)}</div>
      {preview.advice && <details className="csv-ai-review"><summary><Icon name="spark" size={16}/> Vlerësimi i Agjentit</summary><p className="csv-advice">{preview.advice}</p></details>}
      {preview.rows.some(r => r.status === "conflict") && <p role="alert">Korrigjo CSV-në ose hiq rreshtat me konflikt dhe vlerëso përsëri. Ende nuk është ruajtur asgjë.</p>}
      {!saved && <button type="button" className="csv-text-button" disabled={busy} onClick={() => setDetail("settings")}>Përshtat kolonat dhe importin</button>}
      {notice && <p role="alert">{notice}</p>}
    </ProductCsvDialog>}
    {notice && !detail && <p role="status">{notice}</p>}
  </section>;
}
