"use client";
import { useState } from "react";
import { Icon } from "@/components/dashboard/icon";
import type { VisualFlow } from "@/lib/workflows/visual/types";

export type FlowBindingOption = { id: string; name: string; isActive: boolean; bookingEnabled?: boolean };
export type FlowBindingCatalog = { products: FlowBindingOption[]; services: FlowBindingOption[] };
export type FlowBindingFocus = { kind: "product" | "service"; id: string };

export function FlowBindings({ flow, flows, catalog, disabled, focus, onChange, onOpenFlow }: {
  flow: VisualFlow; flows: VisualFlow[]; catalog: FlowBindingCatalog; disabled: boolean; focus?: FlowBindingFocus;
  onChange: (patch: Pick<VisualFlow, "productIds" | "serviceIds">) => void; onOpenFlow: (flowId: string) => void;
}) {
  const [kind, setKind] = useState<"product" | "service">(focus?.kind ?? "product");
  const [query, setQuery] = useState("");
  const field = kind === "product" ? "productIds" : "serviceIds";
  const options = kind === "product" ? catalog.products : catalog.services;
  const selected = flow[field] ?? [];
  const shown = options.filter(option => option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const change = (id: string, checked: boolean) => onChange({ [field]: checked ? [...selected, id] : selected.filter(value => value !== id) });
  const total = (flow.productIds?.length ?? 0) + (flow.serviceIds?.length ?? 0);
  return <section className="vf-bindings" aria-label={`Lidhjet e rrjedhës ${flow.label}`}>
    <header><h3>Përdoret për</h3><span>{total} të zgjedhura</span></header>
    <p className="vf-help">Lidh produktet dhe shërbimet që ndjekin këtë rrjedhë. Ndryshimet hyjnë në fuqi pas publikimit.</p>
    <div className="vf-binding-tabs" role="group" aria-label="Lloji i lidhjes">
      <button type="button" aria-pressed={kind === "product"} onClick={() => { setKind("product"); setQuery(""); }}><Icon name="products" size={14} />Produkte ({flow.productIds?.length ?? 0})</button>
      <button type="button" aria-pressed={kind === "service"} onClick={() => { setKind("service"); setQuery(""); }}><Icon name="briefcase" size={14} />Shërbime ({flow.serviceIds?.length ?? 0})</button>
    </div>
    {selected.length > 0 && <div className="vf-binding-chips">{selected.map(id => <button key={id} type="button" disabled={disabled} onClick={() => change(id, false)} aria-label={`Hiq lidhjen: ${options.find(option => option.id === id)?.name ?? "Element i padisponueshëm"}`}>{options.find(option => option.id === id)?.name ?? "Element i padisponueshëm"}<span aria-hidden="true">×</span></button>)}</div>}
    <input className="vf-binding-search" type="search" aria-label={kind === "product" ? "Kërko produkt për rrjedhën" : "Kërko shërbim për rrjedhën"} placeholder={kind === "product" ? "Kërko produkt…" : "Kërko shërbim…"} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="vf-binding-options">{shown.map(option => {
      const owner = flows.find(item => item.id !== flow.id && item[field]?.includes(option.id));
      return <div key={option.id} className={`vf-binding-option ${focus?.id === option.id && focus.kind === kind ? "is-focused" : ""}`}>
        <label><input type="checkbox" checked={selected.includes(option.id)} disabled={disabled || Boolean(owner) || (selected.length >= 200 && !selected.includes(option.id))} onChange={event => change(option.id, event.target.checked)} /><span><strong>{option.name}</strong><small>{option.isActive ? "Aktiv" : "Joaktiv · mund ta lidhësh tani"}{kind === "service" && !option.bookingEnabled ? " · pa rezervim me orar" : ""}</small></span></label>
        {owner && <button type="button" className="vf-binding-owner" onClick={() => onOpenFlow(owner.id)}>E lidhur te {owner.label} ↗</button>}
      </div>;
    })}{!shown.length && <p className="vf-help">{options.length ? "Nuk u gjet asnjë rezultat." : kind === "product" ? "Shto produkte në katalog për t’i lidhur këtu." : "Shto shërbime për t’i lidhur këtu."}</p>}</div>
    {!total && <p className="vf-field-hint">Pa lidhje të zgjedhura. Rrjedha mbetet e përgjithshme.</p>}
    <p className="vf-field-hint">Një produkt ose shërbim lidhet me një rrjedhë. Lidhja nuk e aktivizon artikullin.</p>
  </section>;
}
