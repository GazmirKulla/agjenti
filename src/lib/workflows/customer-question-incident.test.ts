import { describe, expect, it } from "vitest";
import { migrateContext } from "./context";
import { consumeCustomerQuestion } from "./customer-question";

// Exact production transcripts; synthetic fixtures, never evidence of account ownership.
export const incidentInputs = [
  "Miqail\nSHitje rroba online\nfiliz_studio_\nSa kushton, a e keni kete masen",
  "Për të shmangur ngatërrimin, shkruaj me etiketa:\nEmri: Miqail\nLloji i biznesit: Shitje rroba Online\nInstagram: filiz_studio_\nPyetjet tipike: sa kushton? a e keni masen X? etj",
  "Emri: Miqail\nLloji i biznesit: Shitje rroba Online\nInstagram: filiz_studio_\nPyetjet tipike: sa kushton? a e keni masen X? etj",
];
describe("P0 exact checkpoint incident", () => {
  it.each(incidentInputs.map((message, i) => ({ input: String.fromCharCode(65 + i), message })))("accepts Input $input", ({ message }) => {
    const state = migrateContext();
    // A previously delivered production form must still accept its response.
    const prompt = "Shkruaj nga një përgjigje në çdo rresht, në këtë rend (ose përdor etiketat):\nEmri:\nLloji i biznesit:\nInstagram:\nPyetjet tipike:";
    state.pendingCustomerQuestion = { kind: "customer_facts", businessId: "synthetic", fields: ["name", "business_type", "instagram_handle", "stated_needs"], prompt, expiresAt: 901000 };
    state.recentMessages = [{ role: "assistant", content: prompt }];
    const result = consumeCustomerQuestion(state, { businessId: "synthetic", message, test: true, now: 2000 });
    expect(result?.accepted).toBe(4);
    expect(state.context?.profile.name).toMatchObject({ value: "Miqail", source: "customer_declaration" });
    expect(Object.keys(state.customerDeclaredFacts ?? {})).toHaveLength(3);
    expect(state.pendingCustomerQuestion).toBeUndefined();
    expect(state.context?.order).toEqual({});
  });
});
