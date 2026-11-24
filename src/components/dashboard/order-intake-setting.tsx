"use client";
import { useState } from "react";
import { useManualOperation } from "@/components/dashboard/operation-button";
import { Icon } from "@/components/dashboard/icon";

/**
 * What happens when a customer confirms an order with the agent: the agent registers it, or it only
 * collects the request and staff register it from the conversation. The choice is the business's
 * server-owned order policy (business.orders); saving goes through the same confirmed operation the
 * Assistant uses. `enabled` is null when the policy could not be read.
 */
export function OrderIntakeSetting({ slug, enabled, embedded = false }: { slug: string; enabled: boolean | null; embedded?: boolean }) {
  const [choice, setChoice] = useState<boolean>(enabled ?? false);
  const { prepare, busy, dialog } = useManualOperation(slug, "business.orders");
  if (enabled === null) return <p className="muted-copy">Nuk u lexua si i merr Agjenti porositë. Rifresko faqen.</p>;
  const option = (value: boolean, title: string, hint: string) => (
    <label className="form-label" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <input type="radio" name="order_intake" checked={choice === value} onChange={() => setChoice(value)} disabled={busy} />
      <span><strong>{title}</strong><br /><small className="muted-copy">{hint}</small></span>
    </label>
  );
  return <section className={embedded ? "grid gap-3" : "panel section-pad grid gap-3"} aria-labelledby="order-intake-title">
    {embedded ? <h3 id="order-intake-title" className="capability-part-title"><Icon name="check" size={16} />Kur klienti konfirmon një porosi</h3> : <h2 id="order-intake-title" className="font-semibold">Kur klienti konfirmon një porosi</h2>}
    {option(true, "Agjenti e regjistron porosinë", "Porosia shfaqet te Porositë sapo klienti konfirmon përmbledhjen.")}
    {option(false, "Vetëm mblidh kërkesën", "Agjenti mbledh të dhënat dhe konfirmimin e klientit, por nuk krijon porosi. Stafi e shqyrton te biseda dhe e regjistron.")}
    <div><button type="button" className="btn btn-ghost" disabled={busy || choice === enabled} onClick={() => void prepare({ enabled: choice })}>Ruaj</button></div>
    {dialog}
  </section>;
}
