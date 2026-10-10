import { beforeEach, describe, expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workflows/visual/bindings", () => ({ loadVisualBindings: load }));
import { publishedProductBindings } from "./workflow-binding";

describe("published product bindings", () => {
  beforeEach(() => load.mockReset());
  it.each([{ enabled: false, versionId: "published" }, { enabled: true, versionId: null }])("does not activate from an unavailable publication: %j", async flags => {
    load.mockResolvedValue({ ...flags, products: [{ id: "product", flowId: "flow", flowLabel: "Porosi" }] });
    expect((await publishedProductBindings("business")).size).toBe(0);
    expect(load).toHaveBeenCalledWith("business");
  });
  it("uses only assignments from the enabled published version", async () => {
    load.mockResolvedValue({ enabled: true, versionId: "published", products: [{ id: "product", flowId: "flow", flowLabel: "Porosi" }] });
    expect((await publishedProductBindings("business")).get("product")).toEqual({ versionId: "published", flowId: "flow", name: "Porosi" });
  });
});
