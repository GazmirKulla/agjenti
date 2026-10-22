import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/business-assistant/briefing", () => ({
  loadBriefing: mock.load, BriefingError: class extends Error { constructor(public status: number) { super(); } },
}));
import { BriefingError } from "@/lib/business-assistant/briefing";
import { GET } from "./route";
beforeEach(() => { mock.load.mockReset(); });
it("validates period before querying and forbids caching private summaries", async () => {
  expect((await GET(new Request("http://localhost/api/business-assistant/briefing?period=year"))).status).toBe(400);
  expect(mock.load).not.toHaveBeenCalled();
  mock.load.mockResolvedValue({ businessId: "verified" });
  const r = await GET(new Request("http://localhost/api/business-assistant/briefing?slug=test&period=yesterday"));
  expect(mock.load).toHaveBeenCalledWith("test", "yesterday");
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(await r.json()).toEqual({ businessId: "verified" });
});
it.each([401, 403, 409, 503])("preserves failure status %s without leaking database details", async status => {
  mock.load.mockRejectedValue(new BriefingError(status));
  const r = await GET(new Request("http://localhost/api/business-assistant/briefing?slug=test"));
  expect(r.status).toBe(status); expect(await r.json()).toEqual({ error: "briefing_unavailable" });
});
