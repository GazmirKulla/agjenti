"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AddCardData, PayerAuthentication } from "@nebula-ltd/pok-payments-js";

// The POK SDK touches window when it loads, so it runs only in the browser.
const PokAddCard = dynamic(() => import("./billing-pok-widgets").then((m) => m.PokAddCard), { ssr: false, loading: () => <p className="muted-copy">Po hapet formulari i kartës…</p> });
const PokChargeSavedCard = dynamic(() => import("./billing-pok-widgets").then((m) => m.PokChargeSavedCard), { ssr: false });

type PlanOption = { key: "starter" | "professional" | "enterprise"; name: string; price: number };
type Charge = { paymentId: string; orderId: string; payerAuthentication: PayerAuthentication };

async function post<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Diçka nuk shkoi. Provo përsëri.");
  return data as T;
}

export function BillingCheckout({ env, card, currentPlan, paidUntil, plans }: {
  env: "staging" | "production";
  card: { label: string } | null;
  currentPlan: string;
  paidUntil: string | null;
  plans: PlanOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [charge, setCharge] = useState<Charge | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function saveCard(payload: AddCardData) {
    setBusy("card");
    setMessage(null);
    try {
      await post("/api/billing/card", payload);
      setAdding(false);
      setMessage({ tone: "ok", text: "Karta u ruajt." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Karta nuk u ruajt." });
    } finally {
      setBusy(null);
    }
  }

  async function removeCard() {
    if (!window.confirm("Ta heqim kartën e ruajtur? Për pagesën tjetër do të duhet ta shtosh përsëri.")) return;
    setBusy("card");
    try {
      await post("/api/billing/card", undefined, "DELETE");
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Karta nuk u hoq." });
    } finally {
      setBusy(null);
    }
  }

  async function pay(plan: PlanOption) {
    setBusy(plan.key);
    setMessage(null);
    try {
      setCharge(await post<Charge>("/api/billing/payments", { plan: plan.key }));
    } catch (error) {
      setBusy(null);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Pagesa nuk u nis." });
    }
  }

  async function finish(paymentId: string, reported: "success" | "error") {
    setCharge(null);
    try {
      // POK decides; the browser's report only triggers the check.
      const { status } = await post<{ status: string }>(`/api/billing/payments/${paymentId}/sync`);
      if (status === "paid") setMessage({ tone: "ok", text: "Pagesa u krye. Paketa u përditësua." });
      else if (status === "pending") setMessage({ tone: "ok", text: "Pagesa po përpunohet. Rifresko faqen pas pak." });
      else setMessage({ tone: "error", text: reported === "error" ? "Pagesa nuk u krye. Kontrollo kartën ose provo një kartë tjetër." : "Pagesa nuk u konfirmua nga POK." });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Pagesa nuk u kontrollua." });
    } finally {
      setBusy(null);
    }
  }

  const activePaid = paidUntil && Date.parse(paidUntil) > Date.now();
  const paidUntilLabel = paidUntil ? new Intl.DateTimeFormat("sq-AL", { day: "numeric", month: "long", year: "numeric" }).format(new Date(paidUntil)) : null;

  return <section className="panel section-pad billing-checkout" aria-label="Pagesa me kartë">
    <div className="billing-checkout-head">
      <div>
        <h2>Pagesa me kartë (POK)</h2>
        <p className="muted-copy">
          {activePaid && paidUntilLabel
            ? `Paketa është paguar deri më ${paidUntilLabel}. Paguaj përsëri para kësaj date që të vazhdojë pa ndërprerje; përndryshe kthehet në Free.`
            : "Paguan një muaj në një herë me kartën e ruajtur. Banka mund të kërkojë konfirmim (3-D Secure) në çdo pagesë."}
        </p>
        {env === "staging" && <p className="billing-checkout-test">Mjedis prove: përdor vetëm kartat e provës së POK.</p>}
      </div>
      {card && !adding && <div className="billing-checkout-card">
        <strong>{card.label}</strong>
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setAdding(true)}>Ndrysho</button>
        <button type="button" className="btn btn-ghost text-danger" disabled={!!busy} onClick={removeCard}>Hiq</button>
      </div>}
    </div>

    {(!card || adding) && <div className="billing-checkout-form">
      <PokAddCard env={env} onSaved={saveCard} onError={() => setMessage({ tone: "error", text: "Karta nuk u pranua. Kontrollo të dhënat dhe provo përsëri." })} />
      {card && <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Anulo</button>}
    </div>}

    {card && !adding && <div className="billing-checkout-plans">
      {plans.map((plan) => {
        const renew = plan.key === currentPlan && activePaid;
        return <button key={plan.key} type="button" className={renew ? "btn btn-primary" : "btn btn-ghost"} disabled={!!busy} onClick={() => pay(plan)}>
          {busy === plan.key ? "Po paguhet…" : `${renew ? "Rinovo" : "Paguaj"} ${plan.name} · ${plan.price.toLocaleString("sq-AL")} lekë`}
        </button>;
      })}
    </div>}

    {message && <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "billing-checkout-message is-error" : "billing-checkout-message"}>{message.text}</p>}

    {charge && <PokChargeSavedCard
      env={env}
      orderId={charge.orderId}
      payerAuthentication={charge.payerAuthentication}
      onSuccess={() => finish(charge.paymentId, "success")}
      onError={() => finish(charge.paymentId, "error")}
    />}
  </section>;
}
