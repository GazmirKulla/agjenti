import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), updates: [] as unknown[][] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ rpc: m.rpc, from: () => ({ update: (row: unknown) => {
  const call: unknown[] = [row]; m.updates.push(call);
  const chain = { eq: (k: string, v: unknown) => { call.push([k, v]); return chain; }, then: (ok: (r: unknown) => void) => ok({ error: null }) };
  return chain;
} }) }) }));
vi.mock("./queue", () => ({ enqueueDiscovery: vi.fn(), enqueuePublicInstagram: vi.fn() }));
import { aboutText, pageLogo, pageSummary, parseEdits, reviewSources, scanProgress } from "./sources-step";

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

it("finds the site's logo: touch icon, then icon, then og:image", () => {
  const base = "https://zana.al/sq/";
  expect(pageLogo(`<link rel="icon" href="/favicon.png"><link rel="apple-touch-icon" href="/touch.png">`, base)).toBe("https://zana.al/touch.png");
  expect(pageLogo(`<link rel="shortcut icon" href="fav.ico">`, base)).toBe("https://zana.al/sq/fav.ico");
  expect(pageLogo(`<meta property="og:image" content="https://cdn.zana.al/logo.jpg">`, base)).toBe("https://cdn.zana.al/logo.jpg");
  expect(pageLogo(`<link rel="icon" href="javascript:alert(1)">`, base)).toBeUndefined();
  expect(pageSummary(`<title>Zana</title><link rel="icon" href="/i.png">`, base)).toEqual({ title: "Zana", logo: "https://zana.al/i.png" });
});

it("accepts only complete edits", () => {
  const id = "2af8cfe5-5f63-47a1-baf3-959cfea49b79";
  expect(parseEdits(undefined)).toEqual([]);
  expect(parseEdits([{ id, title: " Dërgesa ", body: " 1-4 ditë " }])).toEqual([{ id, title: "Dërgesa", body: "1-4 ditë" }]);
  expect(() => parseEdits([{ id, title: "D", body: "tekst" }])).toThrow();
  expect(() => parseEdits([{ id: "x", title: "Dërgesa", body: "tekst" }])).toThrow();
  expect(() => parseEdits("jo")).toThrow();
});

it("saves edits only for kept entries still waiting, then confirms", async () => {
  m.rpc.mockResolvedValue({ data: { kept: 1, removed: 1 }, error: null });
  m.updates.length = 0;
  const kept = "2af8cfe5-5f63-47a1-baf3-959cfea49b79", dropped = "5f9242bd-1a30-4cc1-a94b-e36300912b36";
  await reviewSources("b", "u", [kept], [{ id: kept, title: "Zonat", body: "Shqipëri dhe Kosovë." }, { id: dropped, title: "Tjetër", body: "Nuk ruhet." }]);
  expect(m.updates).toHaveLength(1);
  expect(m.updates[0][0]).toMatchObject({ title: "Zonat", body: "Shqipëri dhe Kosovë." });
  expect(m.updates[0].slice(1)).toEqual([["id", kept], ["business_id", "b"], ["is_active", false]]);
  expect(m.rpc).toHaveBeenLastCalledWith("review_discovery", { p_business: "b", p_user: "u", p_keep: [kept] });
});
