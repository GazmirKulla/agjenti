"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { entityValidationIssues, fields, labels, normalizeCurrency, value, type Draft, type Entity, type EntityValidationIssue } from "@/lib/business-intelligence/model";
import { businessProfiles, allowedOfferings } from "@/lib/onboarding/rules";
import { canApplyEntity, discoveryConflictGroups, editDiscoveryDraft } from "@/lib/discovery/review";
import type { DashboardSignals } from "@/lib/dashboard/modules/types";
import "./discovery.css";

type Job = { id: string; source: "instagram" | "website"; status: string; stage: string; progress: number; error: string | null; note: string; warnings: string[]; postCount: number; imageCount: number; website: string | null; canResume: boolean };
type State = { available: boolean; error?: string; connection: { username: string | null } | null; draft: Draft; signals: DashboardSignals | null; revision: number; intelligenceRevision: number; confirmedAt: string | null; jobs: Job[] };
const stageLabels: Record<string, string> = { capture: "Duke lexuar përmbajtjen", text: "Duke analizuar tekstet", images: "Duke analizuar fotot", finish: "Duke përgatitur konfigurimin", done: "Analiza u përfundua" };

export function DiscoverySetup({ slug, businessId }: { slug: string; businessId: string }) {
  const router = useRouter();
  const endpoint = `/api/business-discovery?slug=${encodeURIComponent(slug)}`;
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [website, setWebsite] = useState("");
  const [businessType, setBusinessType] = useState("other");
  const [offers, setOffers] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [resolved, setResolved] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [serverIssues, setServerIssues] = useState<EntityValidationIssue[]>([]);
  const [highlighted, setHighlighted] = useState("");
  const [recovery, setRecovery] = useState(false);
  const entityCards = useRef(new Map<string, HTMLDetailsElement>());
  const fieldInputs = useRef(new Map<string, HTMLTextAreaElement | HTMLSelectElement>());
  const refreshButton = useRef<HTMLButtonElement>(null);
  const dirty = useRef(false);
  const selectionTouched = useRef(false);
  const resumePending = useRef(false);
  const reviewedRevision = useRef("");
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data: State = await response.json();
    if (!response.ok) throw new Error(data.error || "Përmbledhja nuk u ngarkua.");
    const revision = `${data.revision}:${data.intelligenceRevision}`;
    if (reviewedRevision.current && reviewedRevision.current !== revision) setConfirmed(false);
    reviewedRevision.current = revision;
    setState(data);
    if (data.available && !dirty.current) {
      setBusinessType(data.signals?.businessType ?? "other");
      setOffers(data.signals?.offeringTypes ?? []);
      if (!selectionTouched.current) setSelected(data.draft.entities.filter((e) => canApplyEntity(data.draft, e.id)).map((e) => e.id));
    }
    return data;
  }, [endpoint]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await load();
        if (!cancelled && data.available && data.jobs.some((job) => job.canResume) && !resumePending.current) {
          resumePending.current = true;
          try { await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resume" }) }); }
          finally { resumePending.current = false; }
        }
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : "Nuk u ngarkua konfigurimi."); }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [endpoint, load]);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setError(""); setNotice(""); setRecovery(false);
    if (action === "confirm" && validationIssues.length) {
      setError("Korrigjo fushat e shënuara përpara konfirmimit.");
      revealEntity(validationIssues[0].entityId, validationIssues[0].field);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, revision: state?.revision, intelligenceRevision: state?.intelligenceRevision, businessType, offeringTypes: offers, edits: Object.entries(edits).map(([id, values]) => ({ id, values })), selected, resolved, confirmed, ...extra }) });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "unresolved_conflicts") {
          await load();
          const id = result.conflicts?.[0]?.entityId;
          if (typeof id === "string") revealEntity(id, result.conflicts[0].field);
        }
        if (result.code === "validation_failed" && Array.isArray(result.issues)) {
          const issues = result.issues.filter((issue: EntityValidationIssue) => typeof issue.entityId === "string" && typeof issue.field === "string" && typeof issue.message === "string");
          setServerIssues(issues);
          if (issues[0]) revealEntity(issues[0].entityId, issues[0].field);
        }
        if (result.code === "platform_changed") {
          setRecovery(true);
          requestAnimationFrame(() => { refreshButton.current?.scrollIntoView({ behavior: "smooth", block: "center" }); refreshButton.current?.focus({ preventScroll: true }); });
        }
        throw new Error(result.error || "Veprimi nuk u përfundua.");
      }
      dirty.current = false; setEdits({}); setResolved([]); setConfirmed(false); setServerIssues([]); setHighlighted("");
      setNotice(result.success || (action === "save" ? "Ndryshimet u ruajtën." : action === "start" ? "Analiza u nis. Mund të vazhdosh në panel ndërsa përgatitet." : "Përmbledhja u rifreskua."));
      await load();
      if (action === "confirm") router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Veprimi dështoi."); }
    finally { setBusy(false); }
  }
  function edit(id: string, field: string, text: string) {
    dirty.current = true;
    setEdits((current) => ({ ...current, [id]: { ...current[id], [field]: text } }));
    setResolved((current) => [...new Set([...current, `${id}:${field}`])]);
    setConfirmed(false);
    setServerIssues((current) => current.filter((issue) => issue.entityId !== id || issue.field !== field));
    setError("");
  }
  function keepCurrent(keys: string[]) {
    dirty.current = true;
    const profile = state?.draft.entities.find((e) => e.target === "profile");
    if (profile && keys.includes(`${profile.id}:businessType`)) {
      const type = value(profile, "businessType");
      if (Object.hasOwn(businessProfiles, type)) {
        setBusinessType(type);
        const allowed = new Set(allowedOfferings(type).map(([id]) => id));
        setOffers((current) => current.filter((id) => allowed.has(id)));
      }
    }
    setResolved((current) => [...new Set([...current, ...keys])]);
    setConfirmed(false);
  }
  function changeBusinessType(type: string) {
    dirty.current = true;
    setBusinessType(type);
    const allowed = new Set(allowedOfferings(type).map(([id]) => id));
    setOffers((current) => current.filter((id) => allowed.has(id)));
    const profile = state?.draft.entities.find((e) => e.target === "profile");
    if (profile) setResolved((current) => [...new Set([...current, `${profile.id}:businessType`])]);
    if (profile) setServerIssues((current) => current.filter((issue) => issue.entityId !== profile.id || issue.field !== "businessType"));
    setError("");
    setConfirmed(false);
  }
  function revealEntity(id: string, field?: string) {
    setHighlighted(id);
    setExpanded((current) => ({ ...current, [id]: true }));
    requestAnimationFrame(() => {
      const input = field ? fieldInputs.current.get(`${id}:${field}`) : undefined;
      (input ?? entityCards.current.get(id))?.scrollIntoView({ behavior: "smooth", block: "center" });
      input?.focus({ preventScroll: true });
    });
  }
  const active = state?.jobs.some((job) => ["queued", "running"].includes(job.status)) ?? false;
  const conflictGroups = state ? discoveryConflictGroups(state.draft, undefined, resolved) : [];
  const pending = conflictGroups.filter((group) => selected.includes(group.entityId));
  const reviewedEntities = state?.available ? editDiscoveryDraft(state.draft, Object.entries(edits).filter(([id]) => state.draft.entities.some((entity) => entity.id === id)).map(([id, values]) => ({ id, values })), []).entities.map((entity) => entity.target === "profile" ? { ...entity, facts: entity.facts.map((fact) => fact.field === "businessType" ? { ...fact, value: businessType } : fact) } : entity) : [];
  const localIssues = entityValidationIssues(reviewedEntities.filter((entity) => selected.includes(entity.id)));
  const validationIssues = [...localIssues, ...serverIssues.filter((issue) => selected.includes(issue.entityId) && !localIssues.some((local) => local.entityId === issue.entityId && local.field === issue.field))];
  const pendingEntityIds = [...new Set([...pending, ...validationIssues].map((group) => group.entityId))].join(",");
  useEffect(() => {
    if (pendingEntityIds) setExpanded((current) => ({ ...current, ...Object.fromEntries(pendingEntityIds.split(",").map((id) => [id, true])) }));
  }, [pendingEntityIds]);
  const latest = (source: string) => state?.jobs.find((job) => job.source === source);
  const suggestion = state?.jobs.find((job) => job.source === "instagram" && job.website)?.website;
  const home = `/b/${slug}`;
  return (
    <section className="discovery" aria-labelledby="discovery-title">
      <header className="discovery-header">
        <p className="setup-eyebrow">KONFIGURIMI I BIZNESIT</p>
        <h1 id="discovery-title">Lidh burimet. Ne përgatisim hapësirën.</h1>
        <p>Lexojmë postimet, fotot dhe website-in për të përgatitur ofertat, njohuritë dhe Agjentin. Ti kontrollon rezultatin.</p>
      </header>
      {!state && <p role="status">Duke ngarkuar konfigurimin…</p>}
      {state && !state.available && <p role="status">{state.error}</p>}
      <div className="discovery-sources">
        <article className="panel section-pad">
          <span className="discovery-number">1</span><h2>Lidh Instagram-in</h2>
          <p>{state?.connection ? `Llogaria @${state.connection.username || "Instagram"} është e lidhur.` : "Lidh llogarinë e biznesit. Analiza nis automatikisht pas autorizimit."}</p>
          <a className="btn btn-primary" href={`/api/instagram/oauth/start?businessId=${businessId}`}>{state?.connection ? "Rilidh Instagram-in" : "Lidh Instagram-in"}</a>
          {state?.connection && state.available && <button className="btn btn-ghost" disabled={busy || active || dirty.current} onClick={() => void run("start", { source: "instagram", force: true })}>Analizo {latest("instagram") ? "përsëri" : "postimet dhe fotot"}</button>}
        </article>
        <article className="panel section-pad">
          <span className="discovery-number">2</span><h2>Shto website-in <small>Opsional</small></h2>
          <p>Plotësojmë informacionin me produktet, shërbimet, kontaktet dhe politikat e publikuara.</p>
          <form onSubmit={(event) => { event.preventDefault(); void run("start", { source: "website", website, force: true }); }}>
            <label className="form-label" htmlFor="discovery-website">Website i biznesit</label>
            <input id="discovery-website" className="field" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://biznesi.al" required maxLength={2000} />
            {suggestion && !website && <button className="soft-link" type="button" onClick={() => setWebsite(suggestion)}>Përdor linkun e gjetur në profil</button>}
            <button className="btn btn-primary" disabled={busy || !state?.available || ["queued", "running"].includes(latest("website")?.status ?? "") || dirty.current}>Analizo website-in</button>
          </form>
          {dirty.current && <p className="muted-copy">Ruaj korrigjimet përpara se të nisësh një analizë tjetër.</p>}
        </article>
      </div>
      {state?.available && state.jobs.length > 0 && <div className="discovery-progress" aria-live="polite">
        {[latest("instagram"), latest("website")].filter((job): job is Job => Boolean(job)).map((job) => <article className="panel section-pad" key={job.id}>
          <strong>{job.source === "instagram" ? "Instagram · postime dhe foto" : "Website"}</strong>
          <p>{job.status === "failed" ? "Analiza kërkon një provë tjetër" : stageLabels[job.stage] ?? "Në pritje"}</p>
          <progress max={100} value={job.progress} aria-label={`Progresi i analizës së ${job.source}`} />
          <p className="muted-copy">{job.note}</p>
          {job.imageCount > 0 && <p className="muted-copy">Deri në {job.imageCount} foto të përzgjedhura për analizën vizuale.</p>}
          {job.warnings.map((warning, index) => <p key={index} className="muted-copy">{warning}</p>)}
          {job.error && <p role="status">{job.error}</p>}
          {job.status === "failed" && <button className="btn btn-ghost" disabled={busy || dirty.current} onClick={() => void run("start", { source: job.source, website: job.website, force: true })}>Provo përsëri</button>}
        </article>)}
        {active && <p>Analiza ruhet dhe vazhdon edhe nëse largohesh nga kjo faqe.</p>}
      </div>}
      {state?.available && state.jobs.length > 0 && state.draft.entities.length > 0 && <section className="panel section-pad discovery-review" aria-labelledby="discovery-review-title">
        <h2 id="discovery-review-title">{state.confirmedAt ? "Konfigurimi u përgatit" : "Ja çfarë kuptuam për biznesin tënd"}</h2>
        {state.confirmedAt ? <>
          <p>Ofertat e përzgjedhura dhe udhëzimet u ruajtën. Produktet me çmim dhe template të vlefshëm u konfiguruan; të tjerat mund t’i përfundosh nga paneli.</p>
          <Link className="btn btn-primary" href={`${home}/agents/test`}>Provo Agjentin →</Link>
          <Link className="btn btn-ghost" href={home}>Shko në panel</Link>
        </> : <>
          <p>Konfigurimi është një propozim. Hiq elementet që nuk dëshiron dhe korrigjo çfarë nevojitet. Çmimet e lexuara nga postimet mund të jenë oferta të vjetra.</p>
          <fieldset disabled={busy || active}>
            {pending.length > 0 && <section className="discovery-conflict-summary" aria-labelledby="discovery-conflict-title">
              <h3 id="discovery-conflict-title">{pending.length === 1 ? "1 fushë kërkon një zgjedhje" : `${pending.length} fusha kërkojnë një zgjedhje`}</h3>
              <p>Burimet dhanë versione të ndryshme. Zgjidh vlerën që dëshiron, korrigjo fushën, ose lëre elementin për më vonë.</p>
              <ul>{pending.map((group) => {
                const entity = state.draft.entities.find((e) => e.id === group.entityId)!;
                return <li key={group.key}><button type="button" onClick={() => revealEntity(entity.id, group.field)}>{value(entity, "name") || value(entity, "title") || labels[entity.target]} · {labels[group.field] ?? group.field}</button></li>;
              })}</ul>
              <button type="button" className="btn btn-ghost" onClick={() => keepCurrent(pending.map((group) => group.key))}>Mbaj vlerat aktuale të këtyre fushave</button>
            </section>}
            {validationIssues.length > 0 && <section className="discovery-validation-summary" aria-labelledby="discovery-validation-title">
              <h3 id="discovery-validation-title">{validationIssues.length === 1 ? "1 fushë pengon konfirmimin" : `${validationIssues.length} fusha pengojnë konfirmimin`}</h3>
              <p>Kartat dhe fushat përkatëse janë shënuar me të kuqe. Korrigjoji dhe ruaj ndryshimet, ose lëri elementet për më vonë.</p>
              <ul>{validationIssues.map((issue) => {
                const entity = reviewedEntities.find((e) => e.id === issue.entityId);
                if (!entity) return null;
                return <li key={`${issue.entityId}:${issue.field}`}><button type="button" onClick={() => revealEntity(issue.entityId, issue.field)}>{value(entity, "name") || value(entity, "title") || labels[entity.target]} · {labels[issue.field] ?? issue.field}</button><p>{issue.message}</p></li>;
              })}</ul>
            </section>}
            <div className="discovery-classification">
              <label className="form-label">Lloji i biznesit
                <select className="field" value={businessType} ref={(element) => { const profile = state.draft.entities.find((e) => e.target === "profile"); if (profile && element) fieldInputs.current.set(`${profile.id}:businessType`, element); }} onChange={(e) => changeBusinessType(e.target.value)}>
                  {Object.entries(businessProfiles).map(([id, profile]) => <option value={id} key={id}>{profile.label}</option>)}
                </select>
              </label>
              <div><p className="form-label">Çfarë ofron</p><div className="discovery-offers">{allowedOfferings(businessType).map(([id, label]) => <label key={id}>
                <input type="checkbox" checked={offers.includes(id)} onChange={() => { dirty.current = true; setOffers((current) => current.includes(id) ? current.filter((v) => v !== id) : ["services", "mixed"].includes(id) ? [id] : [...current.filter((v) => !["services", "mixed"].includes(v)), id]); setConfirmed(false); }} /> {label}
              </label>)}</div></div>
            </div>
            <div className="discovery-entities">{state.draft.entities.map((entity) => <details key={entity.id} className={`discovery-entity${pending.some((group) => group.entityId === entity.id) ? " has-conflicts" : ""}${validationIssues.some((issue) => issue.entityId === entity.id) ? " has-errors" : ""}${highlighted === entity.id ? " is-highlighted" : ""}`} open={expanded[entity.id] ?? false} ref={(element) => { if (element) entityCards.current.set(entity.id, element); else entityCards.current.delete(entity.id); }} onToggle={(event) => { const open = event.currentTarget.open; setExpanded((current) => current[entity.id] === open ? current : { ...current, [entity.id]: open }); }}>
              <summary><span><strong>{entity.target === "agent" ? "Udhëzimet e Agjentit" : (edits[entity.id]?.name ?? (value(entity, "name") || value(entity, "title") || labels[entity.target]))}</strong><small>{labels[entity.target]}{!canApplyEntity(state.draft, entity.id) ? " · ka të dhëna për të plotësuar" : ""}</small>{validationIssues.some((issue) => issue.entityId === entity.id) && <small className="discovery-field-error">Kërkon korrigjim</small>}{conflictGroups.some((group) => group.entityId === entity.id) && <small className="discovery-conflict-badge">{conflictGroups.filter((group) => group.entityId === entity.id).length} {conflictGroups.filter((group) => group.entityId === entity.id).length === 1 ? "fushë" : "fusha"} me mospërputhje</small>}</span><span>{selected.includes(entity.id) ? "Përzgjedhur" : "Për më vonë"}</span></summary>
              <label className="discovery-select"><input type="checkbox" checked={selected.includes(entity.id)} onChange={() => { selectionTouched.current = true; setSelected((current) => current.includes(entity.id) ? current.filter((id) => id !== entity.id) : [...current, entity.id]); setConfirmed(false); setError(""); }} /> Përfshije në konfigurim</label>
              {conflictGroups.filter((group) => group.entityId === entity.id).map((group) => <div className="discovery-conflict" key={group.key}>
                <strong>Zgjidh: {labels[group.field] ?? group.field}</strong>
                <p>Vlera aktuale: {group.current.value}</p>
                <button type="button" className="btn btn-ghost" onClick={() => keepCurrent([group.key])}>Mbaj vlerën aktuale</button>
                {group.alternatives.map((fact, index) => <div className="discovery-conflict-option" key={index}>
                  <p>{sourceLabel(fact.source)}: {fact.value}</p>
                  <button type="button" className="btn btn-ghost" onClick={() => { if (group.field === "businessType" && entity.target === "profile") changeBusinessType(fact.value ?? "other"); edit(entity.id, group.field, fact.value ?? ""); }}>Përdor këtë version</button>
                </div>)}
              </div>)}
              {reviewFields(entity).map((field) => {
                const fact = entity.facts.find((f) => f.field === field);
                const issue = validationIssues.find((issue) => issue.entityId === entity.id && issue.field === field);
                const conflicting = pending.some((group) => group.entityId === entity.id && group.field === field);
                const text = edits[entity.id]?.[field] ?? value(entity, field);
                const currency = field === "currency" ? normalizeCurrency(text) : "";
                const errorId = `discovery-error-${entity.id}-${field}`;
                return <label className={`form-label${issue || conflicting ? " discovery-invalid-field" : ""}`} key={field}>{labels[field] ?? field}
                  {field === "businessType" ? <p>{businessProfiles[businessType as keyof typeof businessProfiles]?.label}</p> : <textarea ref={(element) => { const key = `${entity.id}:${field}`; if (element) fieldInputs.current.set(key, element); else fieldInputs.current.delete(key); }} aria-invalid={Boolean(issue || conflicting)} aria-describedby={issue ? errorId : undefined} className="field" rows={field === "rules" ? 5 : 2} maxLength={8000} value={text} onChange={(e) => edit(entity.id, field, e.target.value)} />}
                  {issue && <span id={errorId} className="discovery-field-error">{issue.message}</span>}
                  {issue && currency && currency !== text && /^[A-Z]{3}$/.test(currency) && <button type="button" className="btn btn-ghost discovery-currency-fix" onClick={() => edit(entity.id, field, currency)}>Përdor {currency}{currency === "ALL" ? " (Lek)" : currency === "EUR" ? " (Euro)" : ""}</button>}
                  {fact?.evidence && <small className="discovery-evidence">{fact.evidenceKind === "recommendation" ? "Rekomandim" : fact.evidenceKind === "visual" ? "Vëzhgim nga foto" : fact.evidenceKind === "ocr" ? "Tekst nga foto" : "Nga burimi"}: {fact.evidence}{fact.confidence < 0.8 ? " · kontrolloje me kujdes" : ""}</small>}
                </label>;
              })}
            </details>)}</div>
            {dirty.current && <p className="muted-copy">Ruaj korrigjimet për të parë konfigurimin e përditësuar përpara konfirmimit.</p>}
            {pending.length > 0 && <p className="discovery-conflict-badge" role="status">{pending.length === 1 ? "Zgjidh fushën e shënuar më sipër" : `Zgjidh ${pending.length} fushat e shënuara më sipër`} përpara konfirmimit.</p>}
            {validationIssues.length > 0 && <div className="discovery-validation-jump" role="status"><span>{validationIssues.length} {validationIssues.length === 1 ? "fushë kërkon korrigjim" : "fusha kërkojnë korrigjim"}.</span><button type="button" className="btn btn-ghost" onClick={() => revealEntity(validationIssues[0].entityId, validationIssues[0].field)}>Shko te fusha problematike ↑</button></div>}
            <label className="discovery-confirm"><input type="checkbox" disabled={dirty.current || pending.length > 0} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I kontrollova elementet e përzgjedhura, përfshirë çmimet dhe propozimet nga fotot.</label>
            <div className="discovery-actions">
              <button className="btn btn-primary" disabled={dirty.current || pending.length > 0 || !confirmed || !selected.length} onClick={() => void run("confirm")}>{busy ? "Duke ruajtur…" : "Konfirmo konfigurimin →"}</button>
              <button className="btn btn-ghost" onClick={() => void run("save")}>Ruaj korrigjimet</button>
              <button ref={refreshButton} className={`btn btn-ghost${recovery ? " discovery-recovery" : ""}`} onClick={() => void run("refresh")}>Rifresko nga paneli</button>
            </div>
          </fieldset>
          {active && <p role="status">Mund ta konfirmosh konfigurimin pasi të përfundojnë analizat.</p>}
        </>}
      </section>}
      {error && <div className="discovery-error" role="alert"><p>{error}</p>{validationIssues.length > 0 && <button type="button" className="soft-link" onClick={() => revealEntity(validationIssues[0].entityId, validationIssues[0].field)}>Shko te fusha problematike ↑</button>}{recovery && <button type="button" className="btn btn-ghost" disabled={busy || active} onClick={() => void run("refresh")}>Rifresko nga paneli</button>}</div>}
      {notice && <p className="discovery-notice" role="status">{notice}</p>}
      <p className="discovery-footer"><Link href={home}>Vazhdo në panel; plotësoje më vonë →</Link></p>
    </section>
  );
}

function sourceLabel(source: string) {
  return ({ website: "Website", instagram: "Instagram", audio: "Audio", manual: "Vlerë manuale", ai_inferred: "Rekomandim" } as Record<string, string>)[source] ?? "Burimi";
}

function reviewFields(entity: Entity): string[] {
  const required = entity.target === "product" ? ["name", "price", "currency"] : entity.target === "agent" ? ["rules"] : entity.target === "knowledge" ? ["title", "body"] : entity.target === "workflow" ? ["name", "steps"] : ["name"];
  return (fields[entity.target] as readonly string[]).filter((field) => required.includes(field) || Boolean(value(entity, field)));
}
