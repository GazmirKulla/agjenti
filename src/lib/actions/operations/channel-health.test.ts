import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ reads: {} as Record<string, unknown>, filters: [] as string[], selects: [] as string[] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  let status = "";
  const q: Record<string, unknown> = {};
  q.select = (columns: string) => { m.selects.push(`${table}:${columns}`); return q; };
  q.eq = (column: string, value: string) => { m.filters.push(`${table}.${column}=${value}`); if (column === "delivery_status") status = value; return q; };
  q.in = (column: string, values: string[]) => { if (column === "delivery_status") status = values.join("|"); return q; };
  for (const k of ["gte", "order", "limit"]) q[k] = () => q;
  q.maybeSingle = () => Promise.resolve({ data: m.reads[status ? `${table}:${status}` : table] ?? null, error: null });
  return q;
} }) }));
import { channelProblem, readChannelHealth } from "./channel-health";

const business = "10000000-0000-4000-8000-000000000001";
const now = Date.parse("2026-11-27T10:00:00Z");
beforeEach(() => {
  m.filters = []; m.selects = [];
  m.reads = { businesses: { slug: "filiz", timezone: "Europe/Tirane" } };
  process.env.NEXT_PUBLIC_APP_URL = "https://agjenti.app";
});

it("names what is wrong with a channel from the stored facts only", () => {
  const base = { status: "connected", tokenExpiresAt: "2027-01-21T00:00:00Z", lastFailedSend: null, lastSuccessfulSend: "2026-11-27T06:30:00Z" };
  expect(channelProblem({ ...base, status: null }, now)).toBe("not_connected");
  expect(channelProblem({ ...base, status: "revoked" }, now)).toBe("disconnected");
  expect(channelProblem({ ...base, tokenExpiresAt: "2026-11-26T00:00:00Z" }, now)).toBe("token_expired");
  expect(channelProblem({ ...base, tokenExpiresAt: "2026-11-30T00:00:00Z" }, now)).toBe("token_expiring");
  expect(channelProblem({ ...base, lastFailedSend: "2026-11-27T08:00:00Z" }, now)).toBe("sends_failing");
  // An old failure followed by successful sends is not a current fault (the token of 20 November was refreshed).
  expect(channelProblem({ ...base, lastFailedSend: "2026-11-20T11:41:44Z" }, now)).toBe("ok");
  expect(channelProblem(base, now)).toBe("ok");
});

it("reads only this business's channels and sends, never a token, and links to its own Integrimet page", async () => {
  m.reads = { ...m.reads,
    instagram_connections: { id: "ig1", status: "connected", username: "filiz_studio_", expires_at: "2027-01-21T00:24:31Z", last_error: null },
    "messages:failed": { created_at: "2026-11-27T08:00:00Z", delivery_error: "Token i Instagramit është i pavlefshëm." },
    "messages:sent|delivered|read": { created_at: "2026-11-27T06:30:00Z", delivery_error: null },
  };
  const [instagram, whatsapp] = await readChannelHealth(business, now);
  expect(instagram).toMatchObject({ channel: "instagram", connected: true, account: "@filiz_studio_", problem: "sends_failing",
    lastFailedSend: { at: "2026-11-27 09:00", error: "Token i Instagramit është i pavlefshëm." }, lastSuccessfulSend: "2026-11-27 07:30",
    tokenExpiresAt: "2027-01-21 01:24", timezone: "Europe/Tirane", manageUrl: "https://agjenti.app/b/filiz/integrations" });
  expect(whatsapp).toMatchObject({ channel: "whatsapp", connected: false, problem: "not_connected", lastFailedSend: null });
  for (const table of ["businesses.id", "instagram_connections.business_id", "whatsapp_connections.business_id", "messages.business_id"])
    expect(m.filters).toContain(`${table}=${business}`);
  expect(m.filters).toContain("messages.instagram_connection_id=ig1");
  expect(m.selects.join(" ")).not.toMatch(/token|ciphertext|secret/i);
  expect(JSON.stringify([instagram, whatsapp])).not.toMatch(/ciphertext|access_token/i);
});

it("gives no link when the app's address is not configured", async () => {
  delete process.env.NEXT_PUBLIC_APP_URL;
  const [instagram] = await readChannelHealth(business, now);
  expect(instagram.manageUrl).toBeNull();
});
