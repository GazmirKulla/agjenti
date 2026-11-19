import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
import { websiteQuoteFound } from "./source-check";
import { knowledgeSourceLabel } from "./context";

describe("knowledge the website no longer says", () => {
  it("finds a quote again despite formatting and spacing, and misses one that is gone", () => {
    const page = "## Dërgesa\n- Tiranë: **1 ditë**\n| Rrethe | 2–3 ditë |";
    expect(websiteQuoteFound("Tiranë: 1 ditë", page)).toBe(true);
    expect(websiteQuoteFound("Rrethe 2–3 ditë", page)).toBe(true);
    expect(websiteQuoteFound("Dërgesa falas mbi 5000 Lekë", page)).toBe(false);
  });
  it("never marks a quote too short to compare", () => {
    expect(websiteQuoteFound("Po", "asgjë")).toBe(true);
  });
  it("tells the owner when an entry was not found in the last read", () => {
    expect(knowledgeSourceLabel({ kind: "website", capturedAt: "2026-11-01T10:00:00Z", notFoundAt: "2026-11-19T10:00:00Z" })).toContain("nuk u gjet në leximin e fundit të faqes");
  });
});
