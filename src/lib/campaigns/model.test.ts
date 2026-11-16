import { describe, expect, it } from "vitest";
import { parseCampaign } from "./model";
const input = { name: "Offer", channel: "instagram", body: "Hello {{emri}}", terms: "While valid", hours: 23, orders: "all", lead: null, offerExpiresAt: null, maxRecipients: 100 };
describe("campaign input boundaries", () => {
  it("keeps an exact immediate-send contract", () => expect(parseCampaign(input)).toEqual(input));
  it.each([0, 24, 1.5, "23", null])("rejects hours %s", hours => expect(() => parseCampaign({ ...input, hours })).toThrow());
  it.each([0, 501, 1.5, "100"]) ("rejects recipient limit %s", maxRecipients => expect(() => parseCampaign({ ...input, maxRecipients })).toThrow());
  it("rejects expired offers and unknown template variables", () => {
    expect(() => parseCampaign({ ...input, offerExpiresAt: "2020-01-01T00:00:00Z" })).toThrow("offer_expired");
    expect(() => parseCampaign({ ...input, body: "{{phone}}" })).toThrow("invalid_variable");
  });
});
