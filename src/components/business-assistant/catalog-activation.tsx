"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { CapabilityAssessment } from "@/lib/capabilities/registry";
import type { CatalogActivationResult } from "@/lib/business-assistant/catalog-activation";
import { productMoney } from "@/lib/products/catalog";

export function CatalogActivationDialog({ slug, onClose, onAssessment }: {
  slug: string; onClose: () => void; onAssessment: (assessment: CapabilityAssessment) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const titleId = useId();
  const [result, setResult] = useState<CatalogActivationResult | null>(null);
  const [selected, setSelected] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState<"inspect" | "confirm" | null>("inspect");
  const [error, setError] = useState("");
  const url = `/api/business-assistant/capability-activation?slug=${encodeURIComponent(slug)}`;
  useEffect(() => {
    mounted.current = true;
    const node = dialog.current;
    node?.showModal();
    const controller = new AbortController();
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "inspect", capability: "product.search" }), signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Kontrolli nuk përfundoi.");
        if (!controller.signal.aborted) setResult(data);
      }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Kontrolli nuk përfundoi."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => { mounted.current = false; controller.abort(); node?.close(); };
  }, [url]);
  async function confirm() {
    const option = result?.options?.find(option => option.id === selected);
    if (lock.current || !approved || !option?.token || result?.status !== "available") return;
    lock.current = true; setBusy("confirm"); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "confirm", token: option.token, approved: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rezultati nuk u konfirmua. Rihap kontrollin para riprovimit.");
      if (!mounted.current) return;
      setResult(data); setSelected(""); setApproved(false);
      if (data.assessment) onAssessment(data.assessment);
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof Error ? error.message : "Rezultati nuk u konfirmua. Rihap kontrollin para riprovimit.");
        // Discard the reviewed ticket on any failure; never retry a mutation blindly.
        setResult(null); setSelected(""); setApproved(false);
      }
    } finally { lock.current = false; if (mounted.current) setBusy(null); }
  }
  function close() {
    if (lock.current) return;
    if (result?.assessment) onAssessment(result.assessment);
    onClose();
  }
  return <dialog ref={dialog} className="catalog-activation-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close(); }}>
    <h3 id={titleId}>Bëje katalogun të kërkueshëm</h3>
    <p>Do të aktivizohet vetëm produkti që zgjedh. Ai mund të shfaqet në kërkime dhe sugjerime të ardhshme të agjentit.</p>
    <p>Nuk ndryshohen çmimi, modulet ose lidhjet ekzistuese. Nuk dërgohet mesazh, nuk krijohet porosi dhe nuk publikohet workflow.</p>
    <p className="action-plan-note">Kërkohet pronar ose administrator, moduli Produkte i lejuar dhe produkt me çmim, monedhë dhe lloj aktiv.</p>
    {busy && <p role="status">{busy === "inspect" ? "Po kontrollohen lejet dhe konfigurimi…" : "Po ruhet dhe rivlerësohet…"}</p>}
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">{result.message}</p>}
    {result?.options?.length ? <fieldset disabled={Boolean(busy)}>
      <legend>Produkti që do të bëhet i kërkueshëm</legend>
      {result.options.map(option => <label className="catalog-activation-option" key={option.id}>
        <input type="radio" name={titleId} value={option.id} checked={selected === option.id} disabled={!option.token}
          onChange={() => { setSelected(option.id); setApproved(false); }} />
        <span><strong>{option.name}</strong><span>{productMoney(option.price, option.currency)}</span>{option.blocker && <small>{option.blocker}</small>}</span>
      </label>)}
      {result.partial && <p>Shfaqen vetëm 20 draftet e para. Lista nuk është e plotë.</p>}
    </fieldset> : null}
    {result?.status === "available" && <label className="catalog-activation-consent">
      <input type="checkbox" checked={approved} disabled={Boolean(busy) || !selected} onChange={event => setApproved(event.target.checked)} />
      Miratoj që produkti i zgjedhur të bëhet i kërkueshëm për klientët.
    </label>}
    <div className="action-plan-actions">
      {result?.status === "available" && <button type="button" disabled={Boolean(busy) || !approved || !selected} onClick={() => void confirm()}>Mirato dhe aktivizo produktin</button>}
      <button type="button" disabled={busy === "confirm"} onClick={close}>{result?.status === "activated" || result?.status === "ready" ? "Kthehu te plani" : "Anulo dhe kthehu te plani"}</button>
    </div>
  </dialog>;
}
