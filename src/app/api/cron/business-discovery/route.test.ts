import { afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/discovery/queue", () => ({ runDiscoveryQueue: m.run }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("scheduled discovery worker", () => {
  it("requires the configured secret before claiming jobs", async () => {
    vi.stubEnv("CRON_SECRET", "configured-secret");
    expect((await GET(new Request("http://localhost/api/cron/business-discovery"))).status).toBe(401);
    expect(m.run).not.toHaveBeenCalled();
    m.run.mockResolvedValue(3);
    const response = await GET(new Request("http://localhost/api/cron/business-discovery", { headers: { authorization: "Bearer configured-secret" } }));
    expect(await response.json()).toEqual({ processed: 3 });
  });
});
