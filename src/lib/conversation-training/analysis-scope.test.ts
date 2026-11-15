import { beforeEach, describe, expect, it, vi } from "vitest";

const BUSINESS = "2af8cfe5-5f63-47a1-baf3-959cfea49b79";
type Row = { business_id: string; thread_key: string; speaker: string; body: string; sent_at: string; analyzed_at: string | null };
let rows: Row[] = [];
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: () => {
      const filters: ((r: Row) => boolean)[] = [];
      const q = {
        select: () => q,
        eq: (c: keyof Row, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        is: (c: keyof Row, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        ilike: (c: keyof Row, pattern: string) => { const needle = pattern.slice(1, -1).toLowerCase(); filters.push((r) => String(r[c]).toLowerCase().includes(needle)); return q; },
        order: () => q,
        limit: () => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).sort((a, b) => b.sent_at.localeCompare(a.sent_at)), error: null }),
      };
      return q;
    },
  }),
}));
const { threadsToAnalyse } = await import("./analysis");

const row = (thread: string, minute: number, body: string, speaker = "customer", analyzed: string | null = null): Row =>
  ({ business_id: BUSINESS, thread_key: thread, speaker, body, sent_at: new Date(Date.UTC(2026, 10, 1, 10, minute)).toISOString(), analyzed_at: analyzed });

describe("what the AI reads", () => {
  beforeEach(() => {
    rows = [
      row("a", 1, "Sa kushton?"),
      row("b", 2, "Ma dërgo te [telefon], Tiranë"),
      row("c", 3, "Shkruami në [email]"),
      // The business wrote a number: not the customer sending contacts.
      row("d", 4, "Na telefononi te [telefon]", "owner"),
      row("e", 5, "[telefon]", "customer", "2026-11-02T00:00:00.000Z"),
      ...Array.from({ length: 60 }, (_, i) => row(`n${i}`, 10 + i, "Përshëndetje")),
    ];
  });

  it("reads at most the chosen number, newest first", async () => {
    const threads = await threadsToAnalyse(BUSINESS, { limit: 50, onlyContacts: false });
    expect(threads).toHaveLength(50);
    expect(threads[0]).toBe("n59");
  });

  it("with contacts only, reads conversations where the customer sent a phone or an email, not yet analysed", async () => {
    expect(await threadsToAnalyse(BUSINESS, { limit: 50, onlyContacts: true })).toEqual(["c", "b"]);
    expect(await threadsToAnalyse(BUSINESS, { limit: 10, onlyContacts: true })).toHaveLength(2);
  });
});
