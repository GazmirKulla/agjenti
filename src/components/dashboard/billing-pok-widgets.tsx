"use client";

import "@nebula-ltd/pok-payments-js/lib/index.css";
import { useEffect, useRef } from "react";
import { AddCardForm, usePOK, type AddCardData, type PayerAuthentication } from "@nebula-ltd/pok-payments-js/react";

type Env = "staging" | "production";

/** POK's own card form. The card is encrypted in the browser; our server only
 * forwards it to POK and keeps the card id it gets back. */
export function PokAddCard({ env, onSaved, onError }: { env: Env; onSaved: (payload: AddCardData) => void; onError: () => void }) {
  return <AddCardForm
    onSuccess={onSaved}
    onError={(error) => { console.error("[pok] add card", error?.type); onError(); }}
    buttonTitle="Ruaj kartën"
    options={{ env, locale: "al", countrySelect: "modal" }}
  />;
}

/** Runs 3-D Secure and the payment for an order already prepared on the server. */
export function PokChargeSavedCard({ env, orderId, payerAuthentication, onSuccess, onError }: {
  env: Env; orderId: string; payerAuthentication: PayerAuthentication; onSuccess: () => void; onError: () => void;
}) {
  const started = useRef(false);
  const { payByCardToken, fetching } = usePOK(orderId, onSuccess, (error) => { console.error("[pok] pay", error?.type); onError(); }, env, "al");
  useEffect(() => {
    if (fetching || started.current) return;
    started.current = true;
    payByCardToken(payerAuthentication);
  }, [fetching, payByCardToken, payerAuthentication]);
  return null;
}
