import { describe, expect, it } from "vitest";
import { connectionAttention } from "./health";

const base = { business_id: "business", updated_at: "2026-11-21T08:00:00Z" };
describe("connections that look active but do not work", () => {
  it("say that a rejected Instagram token must be reconnected", () => {
    const item = connectionAttention("Instagram", { ...base, status: "expired", last_error: "token_rejected: meta_190_460" });
    expect(item).toMatchObject({ kind: "connection", title: "Instagram: Meta e refuzoi token-in, duhet rilidhur", href: "instagram", businessId: "business" });
    expect(item?.detail).toContain("Rilidh Instagram-in");
    expect(item?.detail).toContain("meta_190_460");
  });
  it("keep a webhook subscription error as it was", () => {
    expect(connectionAttention("Instagram", { ...base, status: "connected", last_error: "subscribed_apps: Unsupported request - method type: post" }))
      .toMatchObject({ title: "Instagram: i lidhur, por me gabim", detail: "subscribed_apps: Unsupported request - method type: post" });
  });
  it("leave out a connection that works", () => {
    expect(connectionAttention("WhatsApp", { ...base, status: "connected", last_error: null })).toBeNull();
  });
});
