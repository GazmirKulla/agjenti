import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ connected: vi.fn(), recent: vi.fn(), fetch: vi.fn(), enqueue: vi.fn(), writes: [] as [string, string, unknown][] }));
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({ from: (table: string) => {
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "neq", "not", "in", "limit", "order"]) builder[name] = () => builder;
  for (const name of ["update", "upsert"]) builder[name] = (row: unknown) => { m.writes.push([table, name, row]); return builder; };
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return builder;
} }) }));
vi.mock("@/lib/instagram/account-rules", async (original) => ({ ...await original<object>(), connectedToAnotherBusiness: m.connected, recentPublicRead: m.recent }));
vi.mock("@/lib/instagram/public-profile", async (original) => ({ ...await original<object>(), fetchPublicInstagram: m.fetch, publicScanAvailable: () => true }));
vi.mock("./queue", () => ({ enqueuePublicInstagram: m.enqueue, enqueueDiscovery: vi.fn(), enqueueWebsiteReview: vi.fn() }));
import { previewSources } from "./sources-step";
import { saveInstagramUsername } from "./instagram-username";
import { CONNECTED_ELSEWHERE_MESSAGE, EMPTY_PROFILE_MESSAGE } from "@/lib/instagram/account-rules";

beforeEach(() => { m.writes.length = 0; for (const fn of [m.connected, m.recent, m.fetch, m.enqueue]) fn.mockReset(); m.connected.mockResolvedValue(false); m.recent.mockResolvedValue(null); });

it("onboarding does not read or save an Instagram another business connected", async () => {
  m.connected.mockResolvedValue(true);
  const preview = await previewSources("mine", { username: "@dyqani.al", only: "instagram" });
  expect(preview.instagram).toEqual({ username: "dyqani.al", error: CONNECTED_ELSEWHERE_MESSAGE });
  expect(m.fetch).not.toHaveBeenCalled();
  expect(m.writes.some(([table, op]) => table === "businesses" && op === "update")).toBe(false);
  await expect(saveInstagramUsername("mine", "owner", "dyqani.al")).resolves.toEqual({ error: CONNECTED_ELSEWHERE_MESSAGE });
  expect(m.enqueue).not.toHaveBeenCalled();
});

it("onboarding explains an empty profile instead of offering it for analysis", async () => {
  m.fetch.mockResolvedValue({ profile: { name: "Dyqani" }, posts: [], stats: {} });
  const preview = await previewSources("mine", { username: "dyqani.al", only: "instagram" });
  expect(preview.instagram).toEqual({ username: "dyqani.al", error: EMPTY_PROFILE_MESSAGE });
  expect(m.writes.find(([table, op]) => table === "business_source_previews" && op === "upsert")?.[2]).toMatchObject({ instagram: { username: "dyqani.al" } });
  expect((m.writes.find(([table]) => table === "business_source_previews")?.[2] as { instagram: { profile?: unknown } }).instagram.profile).toBeUndefined();
});

it("onboarding reuses the account read moments ago in an Agjenti.app chat", async () => {
  m.recent.mockResolvedValue({ profile: { name: "Dyqani", biography: "Rroba" }, posts: [{ id: "1", caption: "x", imageUrl: null, permalink: null, mediaType: "IMAGE" }], fetchedAt: "2026-11-13T10:00:00Z" });
  const preview = await previewSources("mine", { username: "dyqani.al", only: "instagram" });
  expect(preview.instagram).toMatchObject({ username: "dyqani.al", biography: "Rroba", postCount: 1 });
  expect(m.fetch).not.toHaveBeenCalled();
});
