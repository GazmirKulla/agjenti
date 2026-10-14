import { afterEach, expect, it, vi } from "vitest";
import { IsolationViolation } from "./execution-context";
import { runIsolated } from "./isolated-run";
import { createServiceSupabase } from "@/lib/supabase/service";

afterEach(() => vi.unstubAllEnvs());

it("fails closed on isolated business mutations and unknown RPCs", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  await runIsolated(async () => {
    const db = createServiceSupabase();
    expect(() => db.from("bookings").insert({ id: "synthetic" })).toThrow(IsolationViolation);
    expect(() => db.from("google_calendar_connections").update({ access_token_encrypted: "x" })).toThrow(
      IsolationViolation,
    );
    expect(() => db.rpc("save_calendar_booking", {})).toThrow(IsolationViolation);
    expect(() => db.rpc("submit_confirmed_order", {})).toThrow(IsolationViolation);
  });
});
