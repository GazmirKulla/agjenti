import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOGO_REFRESH_MS, logoIsStale, logoPathFromUrl, refreshInstagramBusinessLogo, runBusinessLogoRefresh, validLogoImage } from "./logo";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

type Row = Record<string, unknown>;
/** Just enough of the Supabase client for these tests: filtered selects, updates and storage. */
function fakeDb(tables: Record<string, Row[]>, opts: { missingColumns?: boolean } = {}) {
  const updates: { table: string; values: Row; id: unknown }[] = [];
  const uploads: string[] = [];
  const removed: string[][] = [];
  function query(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let update: Row | null = null;
    const run = () => {
      if (opts.missingColumns && table === "businesses" && !update) return { data: null, error: { message: "column logo_url does not exist" } };
      const rows = (tables[table] ?? []).filter(row => filters.every(f => f(row)));
      if (update) {
        for (const row of rows) { Object.assign(row, update); updates.push({ table, values: update, id: row.id }); }
        return { data: null, error: null };
      }
      return { data: rows, error: null };
    };
    const builder = {
      select: () => builder,
      update: (values: Row) => { update = values; return builder; },
      eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return builder; },
      not: (column: string) => { filters.push(row => row[column] != null); return builder; },
      maybeSingle: async () => { const result = run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : null, error: result.error }; },
      then: (resolve: (value: unknown) => void) => resolve(run()),
    };
    return builder;
  }
  const db = {
    from: query,
    storage: {
      from: () => ({
        upload: async (path: string) => { uploads.push(path); return { error: null }; },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/business-logos/${path}` } }),
        remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
      }),
      getBucket: async () => ({ error: null }),
    },
  } as unknown as SupabaseClient;
  return { db, updates, uploads, removed };
}

describe("business logo", () => {
  it("accepts only real images of an allowed type and size", () => {
    expect(validLogoImage(png, "image/png")).toBe(true);
    expect(validLogoImage(jpeg, "image/jpeg")).toBe(true);
    expect(validLogoImage(jpeg, "image/png")).toBe(false);
    expect(validLogoImage(png, "image/gif")).toBe(false);
    expect(validLogoImage(new Uint8Array(), "image/png")).toBe(false);
  });

  it("knows its own stored files and nothing else", () => {
    expect(logoPathFromUrl("https://x.supabase.co/storage/v1/object/public/business-logos/b1/instagram-1.png")).toBe("b1/instagram-1.png");
    expect(logoPathFromUrl("https://scontent.cdninstagram.com/v/t51/p.jpg")).toBeNull();
    expect(logoPathFromUrl(null)).toBeNull();
  });

  it("is checked again after a week", () => {
    const now = Date.parse("2026-11-21T00:00:00Z");
    expect(logoIsStale(null, now)).toBe(true);
    expect(logoIsStale(new Date(now - LOGO_REFRESH_MS + 1000).toISOString(), now)).toBe(false);
    expect(logoIsStale(new Date(now - LOGO_REFRESH_MS).toISOString(), now)).toBe(true);
  });

  it("copies the Instagram photo, replacing the previous Instagram file", async () => {
    const old = "https://x.supabase.co/storage/v1/object/public/business-logos/b1/instagram-old.png";
    const { db, uploads, removed, updates } = fakeDb({
      businesses: [{ id: "b1", logo_url: old, logo_source: "instagram", logo_checked_at: null }],
      instagram_connections: [{ business_id: "b1", ig_user_id: "17", access_token_ciphertext: "x", status: "connected" }],
    });
    const result = await refreshInstagramBusinessLogo(db, "b1", {
      decrypt: () => "token",
      readProfile: async () => ({ profile_picture_url: "https://scontent.cdninstagram.com/p.png" }),
      fetchImage: async () => ({ bytes: png, type: "image/png" }),
    });
    expect(result).toBe("stored");
    expect(uploads[0]).toMatch(/^b1\/instagram-.+\.png$/);
    expect(updates.at(-1)?.values).toMatchObject({ logo_source: "instagram" });
    expect(removed).toEqual([["b1/instagram-old.png"]]);
  });

  it("never replaces an uploaded logo, and changes nothing before the migration", async () => {
    const readProfile = vi.fn();
    const manual = fakeDb({ businesses: [{ id: "b1", logo_url: "u", logo_source: "manual" }], instagram_connections: [{ business_id: "b1", ig_user_id: "1", access_token_ciphertext: "x", status: "connected" }] });
    expect(await refreshInstagramBusinessLogo(manual.db, "b1", { readProfile })).toBe("kept");
    const early = fakeDb({ businesses: [{ id: "b1" }] }, { missingColumns: true });
    expect(await refreshInstagramBusinessLogo(early.db, "b1", { readProfile })).toBe("skipped");
    expect(readProfile).not.toHaveBeenCalled();
  });

  it("waits a week when the account has no photo, and retries an unanswered read or failed download next run", async () => {
    const tables = () => ({ businesses: [{ id: "b1", logo_url: null, logo_source: null, logo_checked_at: null }], instagram_connections: [{ business_id: "b1", ig_user_id: "1", access_token_ciphertext: "x", status: "connected" }] });
    const none = fakeDb(tables());
    expect(await refreshInstagramBusinessLogo(none.db, "b1", { decrypt: () => "t", readProfile: async () => ({}) })).toBe("none");
    expect(none.updates[0].values).toHaveProperty("logo_checked_at");
    const unanswered = fakeDb(tables());
    expect(await refreshInstagramBusinessLogo(unanswered.db, "b1", { decrypt: () => "t", readProfile: async () => undefined })).toBe("skipped");
    expect(unanswered.updates).toEqual([]);
    const failed = fakeDb(tables());
    expect(await refreshInstagramBusinessLogo(failed.db, "b1", { decrypt: () => "t", readProfile: async () => ({ profile_picture_url: "https://p" }), fetchImage: async () => null })).toBe("skipped");
    expect(failed.updates).toEqual([]);
  });

  it("refreshes only connected businesses with a stale logo that did not come from the owner", async () => {
    const now = Date.parse("2026-11-21T00:00:00Z");
    const { db } = fakeDb({
      instagram_connections: [
        { business_id: "stale", status: "connected" }, { business_id: "fresh", status: "connected" },
        { business_id: "manual", status: "connected" }, { business_id: "gone", status: "disconnected" },
      ],
      businesses: [
        { id: "stale", logo_source: "instagram", logo_checked_at: new Date(now - LOGO_REFRESH_MS - 1).toISOString() },
        { id: "fresh", logo_source: "instagram", logo_checked_at: new Date(now - 1000).toISOString() },
        { id: "manual", logo_source: "manual", logo_checked_at: null },
        { id: "gone", logo_source: null, logo_checked_at: null },
      ],
    });
    const refresh = vi.fn(async () => "stored" as const);
    const summary = await runBusinessLogoRefresh(db, { now, refresh });
    expect(refresh.mock.calls.map(call => (call as unknown[])[1])).toEqual(["stale"]);
    expect(summary).toMatchObject({ checked: 1, stored: 1 });
  });
});

describe("loading logos for a list", () => {
  it("never throws and falls back to no logos", async () => {
    const { loadBusinessLogos } = await import("./logo");
    const broken = { from: () => { throw new Error("boom"); } } as unknown as SupabaseClient;
    expect((await loadBusinessLogos(broken, ["b1"])).size).toBe(0);
    const early = fakeDb({ businesses: [{ id: "b1" }] }, { missingColumns: true });
    expect((await loadBusinessLogos(early.db, ["b1"])).size).toBe(0);
    const ready = fakeDb({ businesses: [{ id: "b1", logo_url: "https://l" }, { id: "b2", logo_url: null }] });
    expect([...(await loadBusinessLogos(ready.db, ["b1", "b2"]))]).toEqual([["b1", "https://l"]]);
  });
});
