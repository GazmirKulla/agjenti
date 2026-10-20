"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CapabilityAssessment } from "@/lib/capabilities/registry";
import type { CapabilityActivationResult } from "@/lib/business-assistant/activation-contract";
import { productMoney } from "@/lib/products/catalog";
import { activationFeedback, uncertainActivation, type ActivationFeedback } from "./presentation";

type Props = {
  slug: string; businessName: string; onClose: () => void; onAssessment: (assessment: CapabilityAssessment) => void;
  onOutcome?: (outcome: ActivationFeedback) => void;
};
export function CatalogActivationDialog(props: Props) {
  return <CapabilityActivationDialog {...props} capability="product.search" />;
}

/** Shared presentation/consent only. The server selects two explicit domain services. */
export function CapabilityActivationDialog({ slug, businessName, capability, onClose, onAssessment, onOutcome }: Props & {
  capability: "product.search" | "knowledge.answer";
}) {
  const catalog = capability === "product.search";
  const surface = useRef<HTMLElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const titleId = useId();
  const [result, setResult] = useState<CapabilityActivationResult | null>(null);
  const [selected, setSelected] = useState("");
  const [reviewedName, setReviewedName] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState<"inspect" | "confirm" | null>("inspect");
  const [error, setError] = useState("");
  const url = `/api/business-assistant/capability-activation?slug=${encodeURIComponent(slug)}`;
  useEffect(() => {
    mounted.current = true;
    surface.current?.focus();
    const controller = new AbortController();
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "inspect", capability }), signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Kontrolli nuk përfundoi.");
        if (!controller.signal.aborted) setResult(data);
      }).catch(error => {
        if (!controller.signal.aborted) {
          setError(error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError) ? error.message : "Kontrolli nuk përfundoi. Verifiko lidhjen dhe rihap konfigurimin.");
          setResult({ status: "unverified", changed: false, message: "Nuk u verifikua konfigurimi. Nuk u kërkua aktivizim." });
        }
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => { mounted.current = false; controller.abort(); };
  }, [url, capability]);
  async function confirm() {
    const option = result?.options?.find(option => option.id === selected);
    if (lock.current || !approved || !option?.token || result?.status !== "available") return;
    lock.current = true; setBusy("confirm"); setError(""); setReviewedName(option.name);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "confirm", capability, token: option.token, approved: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rezultati nuk u konfirmua. Rihap kontrollin para riprovimit.");
      if (!mounted.current) return;
      setResult(data); setSelected(""); setApproved(false);
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError) ? error.message : "Rezultati nuk u konfirmua. Rihap kontrollin para riprovimit.");
        // Discard the reviewed ticket on any failure; never retry a mutation blindly.
        setResult({ status: "unverified", changed: null, message: uncertainActivation }); setSelected(""); setApproved(false);
      }
    } finally { lock.current = false; if (mounted.current) setBusy(null); }
  }
  function close() {
    if (lock.current) return;
    if (result) {
      const outcome = activationFeedback(result, capability);
      // An unverified or mismatched response must never make the plan look ready.
      if (!outcome.unverified && result.assessment?.capabilityKey === capability) onAssessment(result.assessment);
      onOutcome?.(reviewedName ? { ...outcome, message: `${reviewedName}: ${outcome.message}` } : outcome);
    }
    onClose();
  }
  const outcome = result ? activationFeedback(result, capability) : null;
  const selectedOption = result?.options?.find(option => option.id === selected);
  return <section ref={surface} tabIndex={-1} role="region" className="catalog-activation-dialog" aria-labelledby={titleId}
    aria-busy={Boolean(busy)} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <h3 id={titleId}>{catalog ? "Bëje katalogun të kërkueshëm" : "Aktivizo njohurinë për përgjigje"}</h3>
    <p className="activation-business">Biznesi: <strong>{businessName}</strong></p>
    <p>{catalog ? "Do të aktivizohet vetëm produkti që zgjedh. Ai mund të shfaqet në kërkime dhe sugjerime të ardhshme të agjentit." :
      "Shqyrto titullin dhe përmbajtjen. Vetëm njohuria që miraton do të bëhet e përdorshme në përgjigjet e ardhshme të agjentit."}</p>
    <p>{catalog ? "Nuk ndryshohen çmimi, modulet ose lidhjet ekzistuese. Nuk dërgohet mesazh, nuk krijohet porosi dhe nuk publikohet workflow." :
      "Nuk krijohet ose gjenerohet përmbajtje, nuk dërgohet mesazh dhe nuk publikohet workflow. Modulet dhe lejet nuk ndryshojnë."}</p>
    <p className="action-plan-status" role="status">{busy === "inspect" ? "Po kontrollojmë konfigurimin…" : busy === "confirm" ? "Duke u kryer" :
      result?.status === "available" && selectedOption?.token ? "Gati për konfirmim" : outcome?.label ?? "Nuk u verifikua"}</p>
    {error && <p role="alert">{error}</p>}
    {outcome && <p role="status">{outcome.message}</p>}
    {result?.status === "unverified" && result.changed === true && <p>Serveri konfirmoi shkrimin, por jo gatishmërinë për përdorim.</p>}
    {result?.options?.length ? <fieldset disabled={Boolean(busy)}>
      <legend>{catalog ? "Produkti që do të bëhet i kërkueshëm" : "Njohuria që do të përdoret në përgjigje"}</legend>
      {result.options.map(option => <label className="catalog-activation-option" key={option.id}>
        <input type="radio" name={titleId} value={option.id} checked={selected === option.id} disabled={!option.token}
          onChange={() => { setSelected(option.id); setApproved(false); }} />
        <span><strong>{option.name}</strong>{catalog ? <span>{productMoney(option.price ?? null, option.currency ?? "")}</span> :
          <span className="activation-knowledge-body">{option.detail}</span>}{option.blocker && <small>{option.blocker}</small>}</span>
      </label>)}
      {result.partial && <p>Shfaqen vetëm 20 draftet e para. Lista nuk është e plotë.</p>}
    </fieldset> : null}
    {selectedOption && <p className="activation-target">Do të aktivizohet: <strong>{selectedOption.name}</strong> · {businessName}</p>}
    {!selectedOption && reviewedName && <p className="activation-target">Rekordi i shqyrtuar: <strong>{reviewedName}</strong> · {businessName}</p>}
    {result?.status === "available" && <label className="catalog-activation-consent">
      <input type="checkbox" checked={approved} disabled={Boolean(busy) || !selected} onChange={event => setApproved(event.target.checked)} />
      {catalog ? "Miratoj që produkti i zgjedhur të bëhet i kërkueshëm për klientët." : "Miratoj që njohuria e zgjedhur të përdoret në përgjigjet për klientët."}
    </label>}
    <div className="action-plan-actions">
      {result?.status === "available" && <button type="button" className="action-plan-primary" disabled={Boolean(busy) || !approved || !selectedOption?.token} onClick={() => void confirm()}>Konfirmo aktivizimin</button>}
      <button type="button" disabled={busy === "confirm"} onClick={close}>{result?.status === "available" || busy === "inspect" ? "Anulo dhe kthehu te plani" : "Kthehu te plani"}</button>
    </div>
    {result?.status === "available" && <p className="action-plan-note">Miratimi vlen 10 minuta. Nëse të dhënat ose lejet ndryshojnë, duhet një kontroll dhe konfirmim i ri.</p>}
  </section>;
}
