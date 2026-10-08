"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { entityValidationIssues, fields, labels, normalizeCurrency, value, type Draft, type Entity, type EntityValidationIssue, type Target } from "@/lib/business-intelligence/model";
import { businessProfiles, allowedOfferings } from "@/lib/onboarding/rules";
import { canApplyEntity, discoveryConflictGroups, editDiscoveryDraft, reviewEntityEnabled, reviewSections, sectionModules } from "@/lib/discovery/review";
import type { DashboardProfile, DashboardSignals, ModuleId } from "@/lib/dashboard/modules/types";
import { canEnableModule, normalizeEnabledModules } from "@/lib/dashboard/modules/dependencies";
import { moduleRegistry, toggleableModules } from "@/lib/dashboard/modules/registry";
import "./discovery.css";
import { DiscoveryScanDialog, type ScanJob } from "./scan-dialog";

import { scanKnowledge, knowledgeNotice } from "@/lib/business-intelligence/scan-routing";

type Job = ScanJob & { note: string; warnings: string[]; knowledgeCount?: number; inactiveKnowledgeCount?: number; website: string | null; canResume: boolean };
type State = { available: boolean; error?: string; connection: { username: string | null } | null; draft: Draft; dashboardProfile: DashboardProfile; signals: DashboardSignals | null; revision: number; intelligenceRevision: number; confirmedAt: string | null; jobs: Job[] };
const stageLabels: Record<string, string> = { capture: "Duke lexuar përmbajtjen", text: "Duke analizuar tekstet", images: "Duke analizuar fotot", finish: "Duke përgatitur konfigurimin", done: "Analiza u përfundua" };

export function DiscoverySetup({ slug, businessId }: { slug: string; businessId: string }) {
  const router = useRouter();
  const endpoint = `/api/business-discovery?slug=${encodeURIComponent(slug)}`;
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [startingSource, setStartingSource] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const scanningIds = useRef<string[]>([]);
  const wasAnalyzing = useRef(false);
  const [excludedTargets, setExcludedTargets] = useState<Target[]>([]);
  const [enabledModules, setEnabledModules] = useState<ModuleId[]>([]);
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
  const autoRouted = useRef(new Set<string>());
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
      setExcludedTargets(data.draft.reviewPreferences?.excludedTargets ?? []);
      setEnabledModules(data.draft.reviewPreferences?.enabledModules ?? data.dashboardProfile.enabledModules);
      if (!selectionTouched.current) {
        const review = { ...data.draft, reviewPreferences: { excludedTargets: data.draft.reviewPreferences?.excludedTargets ?? [], excludedEntityIds: data.draft.reviewPreferences?.excludedEntityIds ?? [], enabledModules: data.draft.reviewPreferences?.enabledModules ?? data.dashboardProfile.enabledModules } };
        setSelected(data.draft.entities.filter((e) => e.target !== "knowledge" && reviewEntityEnabled(e, review) && canApplyEntity(data.draft, e.id)).map((e) => e.id));
      }
    }
    return data;
  }, [endpoint]);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await load();
        const revision = `${data.revision}:${data.intelligenceRevision}`;
        if (!cancelled && data.available && !dirty.current && !data.jobs.some(job => ["queued", "running"].includes(job.status)) && scanKnowledge(data.draft).length && !autoRouted.current.has(revision)) {
          autoRouted.current.add(revision);
          const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "route_knowledge", revision: data.revision, intelligenceRevision: data.intelligenceRevision }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Njohuritë nuk u ruajtën.");
          if (!cancelled) { setNotice(result.success || "Njohuritë u ruajtën."); await load(); }
        }
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
    if (action === "start") { setStartingSource(String(extra.source ?? "")); setScanOpen(true); if (!active) scanningIds.current = []; }
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, revision: state?.revision, intelligenceRevision: state?.intelligenceRevision, businessType, offeringTypes: offers, edits: Object.entries(edits).map(([id, values]) => ({ id, values })), selected, resolved, confirmed, reviewPreferences: { excludedTargets, excludedEntityIds: state?.draft.entities.filter((e) => !selected.includes(e.id)).map((e) => e.id) ?? [], enabledModules }, ...extra }) });
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
      setNotice(result.success || (action === "save" ? "Ndryshimet u ruajtën." : action === "start" ? "Analiza u nis. Progresin mund ta ndjekësh këtu." : "Përmbledhja u rifreskua."));
      await load();
      if (action === "confirm") router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Veprimi dështoi."); }
    finally { setBusy(false); setStartingSource(""); }
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
  function chooseSection(target: Target, use: boolean) {
    if (!state || target === "profile") return;
    dirty.current = true; selectionTouched.current = true; setConfirmed(false); setError("");
    setExcludedTargets((current) => use ? current.filter((id) => id !== target) : [...new Set([...current, target])]);
    setSelected((current) => [...current.filter((id) => state.draft.entities.find((e) => e.id === id)?.target !== target), ...(use ? state.draft.entities.filter((e) => e.target === target && canApplyEntity(state.draft, e.id)).map((e) => e.id) : [])]);
    const moduleId = sectionModules[target];
    if (moduleId) setEnabledModules((current) => normalizeEnabledModules(use ? [...current, moduleId] : current.filter((id) => id !== moduleId)));
  }
  function chooseModule(moduleId: ModuleId, use: boolean) {
    dirty.current = true; selectionTouched.current = true; setConfirmed(false); setError("");
    const next = normalizeEnabledModules(use ? [...enabledModules, moduleId] : enabledModules.filter((id) => id !== moduleId));
    setEnabledModules(next);
    const matchingTargets = Object.entries(sectionModules).filter(([, id]) => id === moduleId).map(([target]) => target as Target);
    setExcludedTargets((current) => use ? current.filter((target) => !matchingTargets.includes(target)) : [...new Set([...current, ...matchingTargets])]);
    const disabledTargets = Object.entries(sectionModules).filter(([, id]) => !next.includes(id!)).map(([target]) => target as Target);
    setSelected((current) => current.filter((id) => !disabledTargets.includes(state!.draft.entities.find((e) => e.id === id)!.target)));
  }
  const active = state?.jobs.some((job) => ["queued", "running"].includes(job.status)) ?? false;
  const analyzing = active || Boolean(startingSource);
  const activeJobIds = state?.jobs.filter(job => ["queued", "running"].includes(job.status)).map(job => job.id).join(",") ?? "";
  useEffect(() => {
    if (analyzing && !wasAnalyzing.current) { scanningIds.current = []; setScanOpen(true); }
    if (activeJobIds) scanningIds.current = [...new Set([...scanningIds.current, ...activeJobIds.split(",")])];
    wasAnalyzing.current = analyzing;
  }, [analyzing, activeJobIds]);
  const scanJobs = state?.jobs.filter(job => active ? ["queued", "running"].includes(job.status) || scanningIds.current.includes(job.id) : !startingSource && scanningIds.current.includes(job.id)) ?? [];
  const step = state?.confirmedAt ? 4 : analyzing ? 2 : state?.draft.entities.length ? 3 : 1;
  const conflictGroups = state ? discoveryConflictGroups(state.draft, undefined, resolved) : [];
  const sectionEnabled = (target: Target) => !excludedTargets.includes(target) && (!sectionModules[target] || enabledModules.includes(sectionModules[target]!));
  const pending = conflictGroups.filter((group) => selected.includes(group.entityId));
  const reviewedEntities = state?.available ? editDiscoveryDraft(state.draft, Object.entries(edits).filter(([id]) => state.draft.entities.some((entity) => entity.id === id)).map(([id, values]) => ({ id, values })), []).entities.map((entity) => entity.target === "profile" ? { ...entity, facts: entity.facts.map((fact) => fact.field === "businessType" ? { ...fact, value: businessType } : fact) } : entity) : [];
  const localIssues = entityValidationIssues(reviewedEntities.filter((entity) => entity.target !== "knowledge" && selected.includes(entity.id)));
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
        <p className="setup-eyebrow">ONBOARDING · KONFIGURIMI I BIZNESIT</p>
        <h1 id="discovery-title">Përgatit biznesin, hap pas hapi</h1>
        <p>Lexojmë postimet, fotot dhe website-in për të përgatitur ofertat, njohuritë dhe Agjentin. Ti kontrollon rezultatin.</p>
      </header>
      <ol className="discovery-stepper" aria-label="Hapat e onboarding-ut">
        {["Lidh burimet", "Analiza", "Rishiko dhe zgjidh", "Provo Agjentin"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step > index + 1 ? "is-done" : ""}><span>{step > index + 1 ? "✓" : index + 1}</span>{label}</li>)}
      </ol>
      {!state && <p role="status" className="discovery-loading"><span className="discovery-spinner" aria-hidden="true" /> Duke ngarkuar konfigurimin…</p>}
      <DiscoveryScanDialog open={scanOpen} jobs={scanJobs} startingSource={startingSource} error={error} onClose={() => setScanOpen(false)} onReview={() => { setScanOpen(false); requestAnimationFrame(() => document.getElementById("discovery-review-title")?.scrollIntoView({ behavior: "smooth", block: "start" })); }} />
      {analyzing && <button id="discovery-analysis" type="button" className="discovery-scan-launcher" onClick={() => setScanOpen(true)}><span className="discovery-spinner" aria-hidden="true" /><span><strong>Po njohim biznesin tënd</strong><small>Analiza vazhdon në background. Ndiq postimet dhe progresin.</small></span><span className="discovery-scan-launcher-action">Shiko analizën <span aria-hidden="true">↗</span></span></button>}
      {state && !state.available && <p role="status">{state.error}</p>}
      <div className="discovery-sources" aria-label="Hapi 1: Lidh burimet">
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
          <div className="discovery-job-heading">{["queued", "running"].includes(job.status) && <span className="discovery-spinner" aria-hidden="true" />}<strong>{job.source === "instagram" ? "Instagram · postime dhe foto" : "Website"}</strong><span>{job.status === "completed" ? "✓ Përfundoi" : job.status === "failed" ? "Kërkon vëmendje" : `${job.progress}%`}</span></div>
          <p>{job.status === "failed" ? "Analiza kërkon një provë tjetër" : stageLabels[job.stage] ?? "Në pritje"}</p>
          <progress max={100} value={job.progress} aria-label={`Progresi i analizës së ${job.source}`} />
          <p className="muted-copy">{job.note}</p>
          {Boolean(job.knowledgeCount) && <p className="muted-copy">{knowledgeNotice(job.knowledgeCount!)}{Boolean(job.inactiveKnowledgeCount) && ` ${job.inactiveKnowledgeCount} përgjigje të ndryshme u ruajtën joaktive për kontroll.`}</p>}
          {job.imageCount > 0 && <p className="muted-copy">Deri në {job.imageCount} foto të përzgjedhura për analizën vizuale.</p>}
          {job.warnings.map((warning, index) => <p key={index} className="muted-copy">{warning}</p>)}
          {job.error && <p role="status">{job.error}</p>}
          {job.status === "failed" && <button className="btn btn-ghost" disabled={busy || dirty.current} onClick={() => void run("start", { source: job.source, website: job.website, force: true })}>Provo përsëri</button>}
        </article>)}
        {active && <p>Analiza ruhet dhe vazhdon edhe nëse largohesh nga kjo faqe.</p>}
      </div>}
      {state?.available && !analyzing && state.jobs.length > 0 && state.draft.entities.length > 0 && <section className="panel section-pad discovery-review" aria-labelledby="discovery-review-title">
        <h2 id="discovery-review-title">{state.confirmedAt ? "Konfigurimi u përgatit" : "Rishiko dhe zgjidh çfarë do të përdorësh"}</h2>
        {state.confirmedAt ? <>
          <p>U ruajtën elementet e përzgjedhura dhe zgjedhjet e seksioneve. Propozimet që përjashtove mbeten jashtë këtij konfigurimi. Provo Agjentin përpara përdorimit real.</p>
          <Link className="btn btn-primary" href={`${home}/agents/test`}>Provo Agjentin →</Link>
          <Link className="btn btn-ghost" href={home}>Shko në panel</Link>
          <Link className="soft-link" href={`${home}/settings#modules`}>Ndrysho seksionet që përdor në panel →</Link>
        </> : <>
          <p>Analiza krijon propozime. Mund të çaktivizosh një seksion të tërë ose të përzgjedhësh vetëm disa elemente. Seksionet e çaktivizuara nuk shtohen nga analiza. Çmimet e gjetura duhen kontrolluar.</p>
          <p className="discovery-knowledge-notice">{sectionEnabled("knowledge") ? "FAQ-të dhe informacioni i përgjithshëm ruhen automatikisht te Njohuritë." : "Njohuritë janë çaktivizuar për këtë analizë; FAQ-të nuk do të shtohen."} <Link className="soft-link" href={`${home}/knowledge`}>Shiko Njohuritë →</Link></p>
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
            <div className="discovery-entities">{reviewSections.filter((section) => section.target !== "knowledge" && state.draft.entities.some((entity) => entity.target === section.target)).map((section) => <section className={`discovery-review-group${!sectionEnabled(section.target) ? " is-excluded" : ""}`} key={section.target} aria-label={section.label}>
              <header className="discovery-group-header"><div><h3>{section.label}</h3><p>{section.description}</p><small>{state.draft.entities.filter((e) => e.target === section.target).length} elemente · {sectionEnabled(section.target) ? "Mund t’i përzgjedhësh më poshtë" : "Nuk do të përdoret nga kjo analizë"}</small></div>{section.target === "profile" ? <span className="discovery-required">Informacioni bazë</span> : <label className="discovery-section-switch"><input type="checkbox" checked={sectionEnabled(section.target)} onChange={(event) => chooseSection(section.target, event.target.checked)} /> Përdor këtë seksion</label>}</header>
              {sectionEnabled(section.target) && state.draft.entities.filter((entity) => entity.target === section.target).map((entity) => <details key={entity.id} className={`discovery-entity${pending.some((group) => group.entityId === entity.id) ? " has-conflicts" : ""}${validationIssues.some((issue) => issue.entityId === entity.id) ? " has-errors" : ""}${highlighted === entity.id ? " is-highlighted" : ""}`} open={expanded[entity.id] ?? false} ref={(element) => { if (element) entityCards.current.set(entity.id, element); else entityCards.current.delete(entity.id); }} onToggle={(event) => { const open = event.currentTarget.open; setExpanded((current) => current[entity.id] === open ? current : { ...current, [entity.id]: open }); }}>
              <summary><span><strong>{entity.target === "agent" ? "Udhëzimet e Agjentit" : (edits[entity.id]?.name ?? (value(entity, "name") || value(entity, "title") || labels[entity.target]))}</strong><small>{labels[entity.target]}{!canApplyEntity(state.draft, entity.id) ? " · ka të dhëna për të plotësuar" : ""}</small>{validationIssues.some((issue) => issue.entityId === entity.id) && <small className="discovery-field-error">Kërkon korrigjim</small>}{conflictGroups.some((group) => group.entityId === entity.id) && <small className="discovery-conflict-badge">{conflictGroups.filter((group) => group.entityId === entity.id).length} {conflictGroups.filter((group) => group.entityId === entity.id).length === 1 ? "fushë" : "fusha"} me mospërputhje</small>}</span><span>{selected.includes(entity.id) ? "Përzgjedhur" : "Për më vonë"}</span></summary>
              {entity.target !== "profile" && <label className="discovery-select"><input type="checkbox" checked={selected.includes(entity.id)} onChange={() => { selectionTouched.current = true; setSelected((current) => current.includes(entity.id) ? current.filter((id) => id !== entity.id) : [...current, entity.id]); dirty.current = true; setConfirmed(false); setError(""); }} /> Përfshije në konfigurim</label>}
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
            </details>)}
            </section>)}</div>
            <section className="discovery-module-choice" aria-labelledby="discovery-modules-title"><h3 id="discovery-modules-title">Cilat seksione dëshiron në panel?</h3><p>Propozimet nuk aktivizojnë çdo seksion. Zgjidh çfarë të duhet; mund t’i ndryshosh më vonë te Cilësimet. Kur heq një seksion, hiqen edhe seksionet që varen prej tij.</p><div className="discovery-module-grid">{toggleableModules.map((id) => {
              const allowed = canEnableModule(id, new Set(enabledModules));
              return <label key={id}><input type="checkbox" checked={enabledModules.includes(id)} disabled={!enabledModules.includes(id) && !allowed.ok} onChange={(event) => chooseModule(id, event.target.checked)} /><span><strong>{moduleRegistry[id].label}</strong><small>{!allowed.ok ? allowed.reason : moduleRegistry[id].description}</small></span></label>;
            })}</div></section>
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
