import { afterEach, expect, it, vi } from "vitest";
import { saveWorkflowFromEditor } from "./save-client";
import { starterVisualGraph } from "./model";

afterEach(() => vi.unstubAllGlobals());
it("saves through a stable endpoint without deployment-specific action IDs", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ savedRevision: 3, refreshRequired: true, warning: "U ruajt" }));
  vi.stubGlobal("fetch", fetcher);
  const graph = starterVisualGraph();
  expect(await saveWorkflowFromEditor("studio", 2, "draft", graph)).toMatchObject({ savedRevision: 3, refreshRequired: true });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("/api/workflows/visual");
  expect(options.credentials).toBe("same-origin");
  expect(JSON.parse(options.body)).toEqual({ slug: "studio", revision: 2, operation: "draft", graph });
});
it.each(["network", "html", "missing receipt"])("preserves an uncertain save without automatically retrying: %s", async failure => {
  const fetcher = vi.fn();
  if (failure === "network") fetcher.mockRejectedValue(new Error("offline"));
  else fetcher.mockResolvedValue(failure === "html" ? new Response("maintenance", { status: 503 }) : Response.json({}));
  vi.stubGlobal("fetch", fetcher);
  expect((await saveWorkflowFromEditor("studio", 2, "draft", starterVisualGraph())).error).toContain("nuk u konfirmua");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("keeps revision-conflict details for the editor", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Rifresko", errors: [{ message: "Konflikt" }] })));
  expect(await saveWorkflowFromEditor("studio", 2, "publish", starterVisualGraph())).toEqual({ error: "Rifresko", errors: [{ message: "Konflikt" }] });
});
