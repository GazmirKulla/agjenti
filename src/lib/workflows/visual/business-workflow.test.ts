import { expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("./store", () => ({ loadVisualVersion: load }));
import { publishedBusinessWorkflow } from "./business-workflow";

it("uses the enabled main publication's name, not a branch name", async () => {
  load.mockResolvedValue({ graph: { name: "Rrjedha e workflow 1", flows: [{ label: "Kalo te stafi" }] } });
  expect(await publishedBusinessWorkflow("business")).toEqual({ name: "Rrjedha e workflow 1", active: true, status: "Aktiv" });
  expect(load).toHaveBeenCalledWith("business");
  load.mockResolvedValue(null);
  expect(await publishedBusinessWorkflow("business")).toBeNull();
  load.mockRejectedValue(new Error("unavailable"));
  await expect(publishedBusinessWorkflow("business")).rejects.toThrow("unavailable");
});
