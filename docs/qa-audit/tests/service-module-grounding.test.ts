import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readBusinessGrounding } from "@/lib/agents/business-grounding";
import { processGroundingContext } from "@/lib/orchestration/grounding-context";
import { canEnableModule } from "@/lib/dashboard/modules/dependencies";
it("allows services independently of knowledge", () => {
 expect(canEnableModule("services", new Set(["services"]))).toEqual({ ok: true });
});
it.each([["services"], ["services", "knowledge"], ["knowledge"]])("uses canonical services and excludes service mirrors with modules %j", async (...modules: string[]) => {
 const from = vi.fn((table: string) => {
  const records = table === "booking_services" ? [{ id: "service", name: "Dental cleaning", price_amount: 50, currency: "EUR" }]
   : table === "knowledge_entries" ? [{ id: "mirror", title: "Dental cleaning", body: "STALE_PRICE", intent_key: "service" }, { id: "policy", title: "Policy", body: "POLICY", intent_key: "general" }] : [];
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
   then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: records, count: records.length, error: null }).then(resolve) };
  return chain;
 });
 const read = await readBusinessGrounding({ from } as unknown as SupabaseClient, "tenant", modules);
 const context = await processGroundingContext(read, "Service price and policy?", Date.now() + 1000);
 expect(context.services.records).toHaveLength(modules.includes("services") ? 1 : 0);
 if (modules.includes("services")) expect(context.services.records[0]).toMatchObject({ price_amount: 50, currency: "EUR" });
 expect(JSON.stringify(context)).not.toContain("STALE_PRICE");
 expect(context.knowledge.records).toHaveLength(modules.includes("knowledge") ? 1 : 0);
});
