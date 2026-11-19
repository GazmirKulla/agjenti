import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: "owner" as string | null, inserted: [] as unknown[], member: null as unknown }));
vi.mock("@/lib/tenant/access", () => ({ isPlatformAdmin: async () => false }));
vi.mock("@/lib/crypto/tokens", () => ({ encryptSecret: (v: string) => `enc:${v}`, decryptSecret: (v: string) => v.slice(4) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const q: Record<string, unknown> = {};
  Object.assign(q, { select: () => q, eq: () => q, gt: () => q, order: () => q,
    update: () => q, insert: async (row: unknown) => { m.inserted.push(row); return { error: null }; },
    maybeSingle: async () => ({ data: table === "business_users" ? (q.__member ? m.member : m.role ? { role: m.role } : null) : null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) });
  const select = q.select as () => unknown;
  q.select = (columns: string) => { if (typeof columns === "string" && columns.includes("profiles!inner")) q.__member = true; return select(); };
  return q;
} }) }));
import { inviteMember, TeamError } from "./service";

beforeEach(() => { m.role = "owner"; m.inserted = []; m.member = null; process.env.NEXT_PUBLIC_APP_URL = "https://app.test"; });

describe("inviting someone to the business's team", () => {
  it("lets an owner invite by email with a role, as a link that holds only a hashed token", async () => {
    const invited = await inviteMember("b", "u", { email: " Ana@Shembull.com ", role: "staff" });
    expect(invited.email).toBe("ana@shembull.com");
    expect(invited.link).toMatch(/^https:\/\/app\.test\/team\/join\?token=[A-Za-z0-9_-]{43}$/);
    const row = m.inserted[0] as { token_hash: string; token_ciphertext: string; role: string };
    expect(row.role).toBe("staff");
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(invited.link).not.toContain(row.token_hash);
  });
  it("refuses a non-owner, a bad email and an unknown role", async () => {
    m.role = "staff";
    await expect(inviteMember("b", "u", { email: "a@b.co", role: "staff" })).rejects.toBeInstanceOf(TeamError);
    m.role = "owner";
    await expect(inviteMember("b", "u", { email: "jo-email", role: "staff" })).rejects.toThrow("email");
    await expect(inviteMember("b", "u", { email: "a@b.co", role: "admin" })).rejects.toThrow("rolin");
  });
});
