import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => { throw new Error("no live database in tests"); } }));
import { connectedToAnotherBusiness, emptyPublicProfile, recentPublicRead } from "./account-rules";

function db(rows: Record<string, unknown>) {
  const filters: unknown[][] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const name of ["select", "eq", "neq", "gte", "order", "limit"]) builder[name] = (...args: unknown[]) => { filters.push([table, name, ...args]); return builder; };
    const result = () => Promise.resolve({ data: rows[table] ?? null, error: null });
    builder.maybeSingle = result;
    builder.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => result().then(ok, ko);
    return builder;
  };
  return { client: { from } as never, filters };
}

it("treats only an Instagram login on another business as ownership", async () => {
  const taken = db({ instagram_connections: [{ business_id: "other" }] });
  await expect(connectedToAnotherBusiness("Dyqani.AL", "mine", taken.client)).resolves.toBe(true);
  expect(taken.filters).toContainEqual(["instagram_connections", "eq", "username", "dyqani.al"]);
  expect(taken.filters).toContainEqual(["instagram_connections", "neq", "business_id", "mine"]);
  await expect(connectedToAnotherBusiness("dyqani.al", "mine", db({ instagram_connections: [] }).client)).resolves.toBe(false);
});

it("calls a profile empty only without posts, description and website", () => {
  expect(emptyPublicProfile({ profile: { name: "Dyqani" }, posts: [] })).toBe(true);
  expect(emptyPublicProfile({ profile: {}, posts: [{ caption: "  ", imageUrl: null }] })).toBe(true);
  expect(emptyPublicProfile({ profile: { biography: "Rroba" }, posts: [] })).toBe(false);
  expect(emptyPublicProfile({ profile: {}, posts: [{ caption: null, imageUrl: "https://cdn/x.jpg" }] })).toBe(false);
  expect(emptyPublicProfile({ profile: { website: "https://dyqani.al" }, posts: null })).toBe(false);
});

it("reuses a read from the last hours, from a chat or an onboarding preview", async () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  const fromChat = db({ prospect_scans: { profile: { name: "D" }, posts: [], stats: null, fetched_at: "2026-11-13T10:00:00Z" } });
  await expect(recentPublicRead("dyqani.al", fromChat.client, now)).resolves.toMatchObject({ fetchedAt: "2026-11-13T10:00:00Z" });
  const fromPreview = db({ business_source_previews: { instagram: { username: "dyqani.al", profile: { name: "D" }, posts: [], fetchedAt: "2026-11-13T09:00:00Z" } } });
  await expect(recentPublicRead("dyqani.al", fromPreview.client, now)).resolves.toMatchObject({ fetchedAt: "2026-11-13T09:00:00Z" });
  const stale = db({ business_source_previews: { instagram: { username: "dyqani.al", profile: {}, posts: [], fetchedAt: "2026-11-13T01:00:00Z" } } });
  await expect(recentPublicRead("dyqani.al", stale.client, now)).resolves.toBeNull();
});
