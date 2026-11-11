import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
import { readinessFrom, readinessSummary } from "./readiness";
import type { SetupStatus } from "./model";

const status: SetupStatus = { available: true, connected: true, productCount: 0, usableProducts: 0, unconfiguredProducts: 0,
  knowledgeCount: 3, agentReady: true, signature: "s", tested: false, launched: false };

it("is ready to go live without a test, and live only with replies on", () => {
  const ready = readinessFrom(status, false, { instagram: "zana", whatsapp: false }, "/b/zana");
  expect(ready.live).toBe(false);
  expect(ready.blocked).toBeNull();
  expect(readinessSummary(ready)).toMatchObject({ live: false, done: 3, total: 4, next: { key: "live", path: "/b/zana/integrations" } });
  expect(readinessFrom(status, true, { instagram: "zana", whatsapp: false }, "/b/zana").live).toBe(true);
});

it("points at the channel first when nothing is connected", () => {
  const ready = readinessFrom({ ...status, connected: false }, false, { instagram: null, whatsapp: false }, "/b/zana");
  expect(ready.blocked).toMatch(/Lidh Instagram-in/);
  expect(readinessSummary(ready)?.next).toMatchObject({ key: "channel", path: "/b/zana/integrations" });
});
