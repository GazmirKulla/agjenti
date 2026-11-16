import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ row: vi.fn(), download: vi.fn(), filters: [] as [string, unknown][] }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({
    from: () => {
      const chain = { select: () => chain, eq: (c: string, v: unknown) => { m.filters.push([c, v]); return chain; }, maybeSingle: () => m.row() };
      return chain;
    },
    storage: { from: () => ({ download: m.download }) },
  }),
}));

import { GET } from "./route";
import { signedAvatarQuery } from "@/lib/conversations/avatar-link";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CONV = "22222222-2222-4222-8222-222222222222";
const call = (query: string, id = BIZ, conversationId = CONV) =>
  GET(new Request(`https://app.test/api/businesses/${id}/conversations/${conversationId}/avatar?${query}`), { params: Promise.resolve({ id, conversationId }) });

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-key");
  m.filters.length = 0;
  vi.clearAllMocks();
  m.row.mockResolvedValue({ data: { participant_avatar_path: `${BIZ}/instagram/c/1.jpg` }, error: null });
  m.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2])], { type: "image/jpeg" }), error: null });
});
afterEach(() => vi.unstubAllEnvs());

it("serves the photo for a valid signed link with a private, long-lived cache", async () => {
  const res = await call(signedAvatarQuery(BIZ, CONV, "1"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/jpeg");
  expect(res.headers.get("cache-control")).toBe("private, max-age=604800, immutable");
  expect(m.filters).toEqual([["business_id", BIZ], ["id", CONV]]);
});

it("refuses a missing, tampered, expired or other-conversation signature before reading anything", async () => {
  const valid = new URLSearchParams(signedAvatarQuery(BIZ, CONV, "1"));
  const tampered = new URLSearchParams(valid); tampered.set("v", "2");
  const expired = new URLSearchParams(signedAvatarQuery(BIZ, CONV, "1", Date.now() - 30 * 86_400_000));
  for (const query of ["", tampered.toString(), expired.toString()]) expect((await call(query)).status).toBe(403);
  // A link signed for one business never opens another business's conversation.
  expect((await call(valid.toString(), OTHER)).status).toBe(403);
  expect(m.row).not.toHaveBeenCalled();
});

it("returns 404 for a malformed id, no photo, a path outside the business, or a missing file", async () => {
  expect((await call(signedAvatarQuery(BIZ, "x", "1"), BIZ, "not-a-uuid")).status).toBe(404);
  const ok = signedAvatarQuery(BIZ, CONV, "1");
  m.row.mockResolvedValueOnce({ data: { participant_avatar_path: null }, error: null });
  expect((await call(ok)).status).toBe(404);
  m.row.mockResolvedValueOnce({ data: { participant_avatar_path: "other-business/instagram/c/1.jpg" }, error: null });
  expect((await call(ok)).status).toBe(404);
  m.download.mockResolvedValueOnce({ data: null, error: { message: "missing" } });
  expect((await call(ok)).status).toBe(404);
});

it("reports a database failure as unavailable, not as a missing photo", async () => {
  m.row.mockResolvedValueOnce({ data: null, error: { message: "down" } });
  expect((await call(signedAvatarQuery(BIZ, CONV, "1"))).status).toBe(503);
});
