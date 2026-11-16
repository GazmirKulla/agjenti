import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ access: vi.fn(), row: vi.fn(), download: vi.fn(), filters: [] as [string, unknown][] }));
vi.mock("@/lib/conversations/transport-access", async (original) => ({
  ...(await original<typeof import("@/lib/conversations/transport-access")>()),
  transportAccess: m.access,
}));

import { GET } from "./route";

const BIZ = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const db = {
  from: () => {
    const chain = { select: () => chain, eq: (c: string, v: unknown) => { m.filters.push([c, v]); return chain; }, maybeSingle: () => m.row() };
    return chain;
  },
  storage: { from: () => ({ download: m.download }) },
};
const call = (conversationId = CONV) => GET(new Request(`https://app.test/api/businesses/${BIZ}/conversations/${conversationId}/avatar?v=1`), { params: Promise.resolve({ id: BIZ, conversationId }) });

beforeEach(() => {
  m.filters.length = 0;
  vi.clearAllMocks();
  m.access.mockResolvedValue({ userId: "u", db });
  m.row.mockResolvedValue({ data: { participant_avatar_path: `${BIZ}/instagram/c/1.jpg` }, error: null });
  m.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2])], { type: "image/jpeg" }), error: null });
});

it("serves the photo with a private, long-lived cache so Inbox refreshes reuse it", async () => {
  const res = await call();
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/jpeg");
  expect(res.headers.get("cache-control")).toBe("private, max-age=604800, immutable");
  expect(m.filters).toEqual([["business_id", BIZ], ["id", CONV]]);
  expect(m.download).toHaveBeenCalledWith(`${BIZ}/instagram/c/1.jpg`);
});

it("refuses non-members before reading anything", async () => {
  m.access.mockResolvedValue(null);
  expect((await call()).status).toBe(403);
  expect(m.row).not.toHaveBeenCalled();
});

it("returns 404 for a malformed id, no photo, a path outside the business, or a missing file", async () => {
  expect((await call("not-a-uuid")).status).toBe(404);
  m.row.mockResolvedValueOnce({ data: { participant_avatar_path: null }, error: null });
  expect((await call()).status).toBe(404);
  m.row.mockResolvedValueOnce({ data: { participant_avatar_path: "other-business/instagram/c/1.jpg" }, error: null });
  expect((await call()).status).toBe(404);
  m.download.mockResolvedValueOnce({ data: null, error: { message: "missing" } });
  const missing = await call();
  expect(missing.status).toBe(404);
  expect(missing.headers.get("cache-control")).toBe("no-store");
});

it("reports a database failure as unavailable, not as a missing photo", async () => {
  m.row.mockResolvedValueOnce({ data: null, error: { message: "down" } });
  expect((await call()).status).toBe(503);
});
