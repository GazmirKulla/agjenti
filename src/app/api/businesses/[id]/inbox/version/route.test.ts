import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), version: vi.fn() }));
vi.mock("@/lib/conversations/transport-access", async (original) => ({
  ...(await original<typeof import("@/lib/conversations/transport-access")>()), transportAccess: m.access,
}));
vi.mock("@/lib/conversations/inbox-version", () => ({ loadInboxVersion: m.version }));
import { GET } from "./route";

const BIZ = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const call = (query = "") => GET(new Request(`https://app.test/api/businesses/${BIZ}/inbox/version${query}`), { params: Promise.resolve({ id: BIZ }) });
beforeEach(() => { vi.clearAllMocks(); m.access.mockResolvedValue({ userId: "u", db: {} }); m.version.mockResolvedValue("v1"); });

it("returns the fingerprint for members, uncached", async () => {
  const res = await call(`?conversation=${CONV}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ version: "v1" });
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(m.version).toHaveBeenCalledWith({}, BIZ, CONV);
});

it("refuses non-members and malformed conversation ids before reading", async () => {
  expect((await call("?conversation=x")).status).toBe(400);
  m.access.mockResolvedValue(null);
  expect((await call()).status).toBe(403);
  expect(m.version).not.toHaveBeenCalled();
});

it("reports a failed read as unavailable so the page does not re-render on errors", async () => {
  m.version.mockRejectedValue(new Error("down"));
  expect((await call()).status).toBe(503);
});
