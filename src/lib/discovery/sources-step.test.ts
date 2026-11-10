import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc }) }));
vi.mock("./queue", () => ({ enqueueDiscovery: vi.fn(), enqueuePublicInstagram: vi.fn() }));
import { aboutText, pageSummary, reviewSources, scanProgress } from "./sources-step";

it("reads the first page's name and description without AI", () => {
  const html = `<html><head><title>Zana Store | Bluza</title><meta property="og:site_name" content="Zana Store"><meta name="description" content="Bluza me printim &amp; dhurata të personalizuara."></head></html>`;
  expect(pageSummary(html)).toEqual({ title: "Zana Store", description: "Bluza me printim & dhurata të personalizuara." });
  expect(pageSummary("<title> Vetëm titulli </title>")).toEqual({ title: "Vetëm titulli" });
});

it("saves the bio and the site's description as the general text", () => {
  const text = aboutText(
    { username: "zana.store", name: "Zana", biography: "Bluza të personalizuara 🎁", website: "https://zana.al/", postCount: 5 },
    { url: "https://zana.al/", title: "Zana", description: "Dyqan online në Tiranë." },
  );
  expect(text).toBe("Bluza të personalizuara 🎁\nDyqan online në Tiranë.\nWebsite: https://zana.al/\nInstagram: @zana.store");
  // The same site through http and https is listed once.
  expect(aboutText({ username: "z", biography: "Puzzle druri", website: "http://www.zana.al/", postCount: 5 }, { url: "https://zana.al/sq" }))
    .toBe("Puzzle druri\nWebsite: https://zana.al/sq\nInstagram: @z");
  expect(aboutText({ username: "x", error: "nuk u gjet" }, null)).toBeNull();
});

it("confirms only well-formed choices and dismisses with null", async () => {
  m.rpc.mockResolvedValue({ data: { kept: 1, removed: 2 }, error: null });
  await expect(reviewSources("b", "u", ["not-an-id"])).rejects.toThrow();
  const id = "2af8cfe5-5f63-47a1-baf3-959cfea49b79";
  expect(await reviewSources("b", "u", [id])).toEqual({ kept: 1, removed: 2 });
  expect(m.rpc).toHaveBeenLastCalledWith("review_discovery", { p_business: "b", p_user: "u", p_keep: [id] });
  await reviewSources("b", "u", null);
  expect(m.rpc).toHaveBeenLastCalledWith("review_discovery", { p_business: "b", p_user: "u", p_keep: null });
});

it("describes where each scan is for its progress bar", () => {
  expect(scanProgress({ source: "instagram", status: "queued", stage: "capture" })).toEqual({ progress: 5, step: "Në radhë" });
  expect(scanProgress({ source: "instagram", status: "running", stage: "capture" })).toEqual({ progress: 5, step: "Po merren postimet" });
  expect(scanProgress({ source: "instagram", status: "running", stage: "images", checkpoint: { images: [1, 2, 3, 4, 5], nextImage: 2 } }))
    .toEqual({ progress: 54, step: "Po shihen fotot (2 nga 5)" });
  expect(scanProgress({ source: "website", status: "queued", stage: "finish" })).toEqual({ progress: 95, step: "Po përgatitet propozimi" });
  expect(scanProgress({ source: "website", status: "completed", stage: "done" })).toEqual({ progress: 100, step: "Gati" });
});
