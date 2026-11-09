"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { manageCustomer } from "@/lib/customers/actions";
import type { CustomerAction } from "@/lib/customers/types";

/** Owner actions for one customer, with an explicit second step for permanent deletion. */
export function CustomerActions({ slug, customerId, name, archived, orders }: {
  slug: string;
  customerId: string;
  name: string;
  archived: boolean;
  orders: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, start] = useTransition();
  const run = (action: CustomerAction) => start(async () => {
    const result = await manageCustomer(slug, customerId, action);
    setMessage(result.error ? { text: result.error, error: true } : { text: result.success ?? "", error: false });
    setConfirming(false);
    if (!result.error) router.refresh();
  });
  return (
    <div className="detail-block customer-actions">
      <h3>Menaxho klientin</h3>
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "customer-actions-error" : "muted-copy"}>{message.text}</p>}
      {!confirming ? (
        <div className="customer-actions-row">
          {archived
            ? <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run("restore")}>Rikthe në listë</button>
            : <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => run("archive")}>Hiq nga lista</button>}
          <button type="button" className="btn btn-ghost customer-actions-danger" disabled={pending} onClick={() => setConfirming(true)}>Fshi përgjithmonë</button>
        </div>
      ) : (
        <div className="customer-actions-confirm" role="alertdialog" aria-label={`Fshi përgjithmonë ${name}`}>
          <p>
            Fshi përgjithmonë <strong>{name}</strong>? Hiqen kontakti{orders ? ` dhe ${orders} porosi` : " dhe porositë e tij"}.
            Bisedat mbeten në Inbox. Ky veprim nuk kthehet mbrapsht.
          </p>
          <div className="customer-actions-row">
            <button type="button" className="btn btn-primary customer-actions-danger-solid" disabled={pending} onClick={() => run("delete")}>Po, fshije përgjithmonë</button>
            <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>Anulo</button>
          </div>
        </div>
      )}
      {!archived && !confirming && <p className="muted-copy">“Hiq nga lista” nuk fshin asgjë: klienti kalon te “Të arkivuar” dhe rikthehet vetë kur bën një porosi të re.</p>}
    </div>
  );
}
