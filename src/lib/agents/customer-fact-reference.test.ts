import { expect, it } from "vitest";
import { customerFactReference } from "./customer-fact-reference";
import { projectCustomerContext } from "./customer-context";
import { validateResponse } from "./response-consistency";
import { migrateContext } from "@/lib/workflows/context";

it.each([
  ["Ku duhet ta lidh Instagramin tim?", "Lidhja bëhet nga paneli."],
  ["What do I need to connect my Instagram?", "Connect the account through the dashboard."],
  ["Si funksionon emaili im?", "Shpjegimi varet nga shërbimi i konfiguruar."],
  ["okay super, por ju mesazhet i ktheni nga instagrami im domethen?", "Përgjigjet dërgohen nga llogaria e lidhur në Instagram, pas autorizimit."],
  ["e kam fjalen, mesazhet qe i ktheni klienteve te mi - ja ktheni nga instagrami im, a duhet te ju jap une te dhenat e instagramit apo cfare?", "Lidhja e Instagramit bëhet përmes autorizimit në panel."],
  ["A i dërgoni produktet në adresën time?", "Transporti ofrohet në zonat e mbuluara."],
  ["A më vjen konfirmimi i konsultës në emailin tim?", "Konfirmimet varen nga kanalet e konfiguruara."],
  ["Can you connect my business website?", "Website import requires a supported public source."],
])("does not confuse product usage with personal recall: %s", (message, reply) => {
  const state = migrateContext(), before = structuredClone(state);
  expect(customerFactReference(message)).toBeUndefined();
  const customer = projectCustomerContext(state, message);
  expect(customer.reference).toBeUndefined();
  expect(validateResponse(reply, { state, message, customer, products: [], services: [], informational: true }).reply).toBe(reply);
  expect(state).toEqual(before);
});

it.each([
  ["Cili është profili im në Instagram?", "instagram_handle"],
  ["Instagrami im?", "instagram_handle"],
  ["Më kujto emailin tim.", "email"],
  ["Cila është adresa ime?", "address"],
])("preserves actual recall and blocks invented facts: %s", (message, field) => {
  expect(customerFactReference(message)?.keys).toContain(field);
});
