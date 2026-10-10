import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/workflows/visual/save-service", () => ({ mutateVisualWorkflow: m.save }));
import { POST } from "./route";
const request = (body: unknown, origin = "https://www.agjenti.app") => new Request("https://www.agjenti.app/api/workflows/visual", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
});
const payload = { slug: "studio", revision: 4, operation: "draft", graph: { version: 2 } };
beforeEach(() => { vi.resetAllMocks(); m.save.mockResolvedValue({ savedRevision: 5 }); });
it("uses the authorized mutation service with the expected revision and operation", async () => {
  const result = await POST(request(payload));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ savedRevision: 5 });
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(m.save).toHaveBeenCalledExactlyOnceWith("studio", 4, payload.graph, "draft");
});
it("rejects foreign origins before mutations", async () => {
  expect((await POST(request(payload, "https://attacker.invalid"))).status).toBe(403);
  expect(m.save).not.toHaveBeenCalled();
});
it.each([null, { ...payload, revision: -1 }, { ...payload, operation: "delete" }, { ...payload, slug: "" }])("rejects malformed requests before mutations: %j", async body => {
  expect((await POST(request(body))).status).toBe(400);
  expect(m.save).not.toHaveBeenCalled();
});
it("bounds streamed payloads", async () => {
  expect((await POST(request({ ...payload, graph: "x".repeat(256_000) }))).status).toBe(413);
  expect(m.save).not.toHaveBeenCalled();
});
it("does not leak exceptions or retry an ambiguous commit", async () => {
  m.save.mockRejectedValueOnce(new Error("private database details"));
  const response = await POST(request(payload));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
  expect(m.save).toHaveBeenCalledTimes(1);
});
