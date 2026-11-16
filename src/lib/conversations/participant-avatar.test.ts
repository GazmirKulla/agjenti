import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const profile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/instagram/user-profile", () => ({ fetchInstagramUserProfile: profile }));

import { avatarIsStale, refreshInstagramParticipantAvatar, participantAvatarUrl, AVATAR_REFRESH_MS } from "./participant-avatar";

function fakeDb(options: { uploadError?: unknown } = {}) {
  const calls = { uploads: [] as { path: string; type: string }[], updates: [] as { patch: Record<string, unknown>; filters: [string, unknown][] }[] };
  const db = {
    storage: {
      from: () => ({
        upload: async (path: string, _bytes: Uint8Array, opts: { contentType: string }) => {
          calls.uploads.push({ path, type: opts.contentType });
          return { error: options.uploadError ?? null };
        },
      }),
    },
    from: (table: string) => {
      expect(table).toBe("conversations");
      return {
        update: (patch: Record<string, unknown>) => {
          const entry = { patch, filters: [] as [string, unknown][] };
          calls.updates.push(entry);
          const chain = { eq: (col: string, val: unknown) => { entry.filters.push([col, val]); return chain; }, then: (r: (v: unknown) => void) => r({ error: null }) };
          return chain;
        },
      };
    },
  };
  return { db: db as never, calls };
}

const base = { businessId: "biz-1", connectionId: "conn-1", participantId: "17841400000000001", accessToken: "token" };

beforeEach(() => profile.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("avatarIsStale", () => {
  it("is stale when never checked, unparseable, or older than the refresh window", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(avatarIsStale(null, now)).toBe(true);
    expect(avatarIsStale("not a date", now)).toBe(true);
    expect(avatarIsStale(new Date(now - AVATAR_REFRESH_MS).toISOString(), now)).toBe(true);
    expect(avatarIsStale(new Date(now - 3600_000).toISOString(), now)).toBe(false);
  });
});

describe("refreshInstagramParticipantAvatar", () => {
  it("copies the photo into the business's folder and points every conversation with the participant at it", async () => {
    profile.mockResolvedValue({ ok: true, username: "ana", name: "Ana", profilePic: "https://cdn.example/p.jpg" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })));
    const { db, calls } = fakeDb();
    await expect(refreshInstagramParticipantAvatar({ db, ...base })).resolves.toBe("stored");
    expect(calls.uploads).toEqual([{ path: "biz-1/instagram/conn-1/17841400000000001.jpg", type: "image/jpeg" }]);
    expect(calls.updates[0].patch.participant_avatar_path).toBe("biz-1/instagram/conn-1/17841400000000001.jpg");
    expect(calls.updates[0].filters).toEqual([["business_id", "biz-1"], ["instagram_connection_id", "conn-1"], ["instagram_participant_id", "17841400000000001"]]);
  });

  it("reuses a lookup already made this turn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } })));
    const { db } = fakeDb();
    await refreshInstagramParticipantAvatar({ db, ...base, profile: { ok: true, username: null, name: null, profilePic: "https://cdn.example/p.png" } });
    expect(profile).not.toHaveBeenCalled();
  });

  it("clears the photo when the provider answers without one, so initials come back", async () => {
    profile.mockResolvedValue({ ok: true, username: "ana", name: null, profilePic: null });
    const { db, calls } = fakeDb();
    await expect(refreshInstagramParticipantAvatar({ db, ...base })).resolves.toBe("none");
    expect(calls.uploads).toEqual([]);
    expect(calls.updates[0].patch).toMatchObject({ participant_avatar_path: null });
    expect(calls.updates[0].patch.participant_avatar_checked_at).toEqual(expect.any(String));
  });

  it("leaves the stored state untouched when the lookup, download, type or upload fails, so the next message retries", async () => {
    profile.mockResolvedValue({ ok: false, username: null, name: null, profilePic: null });
    let { db, calls } = fakeDb();
    await expect(refreshInstagramParticipantAvatar({ db, ...base })).resolves.toBe("skipped");
    expect(calls.updates).toEqual([]);

    profile.mockResolvedValue({ ok: true, username: null, name: null, profilePic: "https://cdn.example/p" });
    for (const response of [new Response("x", { status: 403 }), new Response("<html>", { headers: { "content-type": "text/html" } })]) {
      vi.stubGlobal("fetch", vi.fn(async () => response));
      ({ db, calls } = fakeDb());
      await expect(refreshInstagramParticipantAvatar({ db, ...base })).resolves.toBe("skipped");
      expect(calls.updates).toEqual([]);
    }

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    ({ db, calls } = fakeDb());
    await expect(refreshInstagramParticipantAvatar({ db, ...base })).resolves.toBe("skipped");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/webp" } })));
    ({ db, calls } = fakeDb({ uploadError: { message: "denied" } }));
    await expect(refreshInstagramParticipantAvatar({ db, ...base })).resolves.toBe("skipped");
    expect(calls.updates).toEqual([]);
  });

  it("refuses oversized images", async () => {
    profile.mockResolvedValue({ ok: true, username: null, name: null, profilePic: "https://cdn.example/p.jpg" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { "content-type": "image/jpeg" } })));
    const { db, calls } = fakeDb();
    await expect(refreshInstagramParticipantAvatar({ db, ...base })).resolves.toBe("skipped");
    expect(calls.uploads).toEqual([]);
  });

  it("never builds a storage path from a malformed participant id", async () => {
    const { db, calls } = fakeDb();
    await expect(refreshInstagramParticipantAvatar({ db, ...base, participantId: "../other-biz/x" })).resolves.toBe("skipped");
    expect(profile).not.toHaveBeenCalled();
    expect(calls.uploads).toEqual([]);
  });
});

describe("participantAvatarUrl", () => {
  it("is stable across refreshes in the same week and changes when the photo is checked again", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "test-key");
    const at = "2026-11-16T12:00:00.000Z", now = Date.parse("2026-11-16T22:00:00Z");
    const first = participantAvatarUrl("biz-1", "conv-1", "biz-1/instagram/c/1.jpg", at, now)!;
    expect(first.startsWith("/api/businesses/biz-1/conversations/conv-1/avatar?")).toBe(true);
    expect(participantAvatarUrl("biz-1", "conv-1", "biz-1/instagram/c/1.jpg", at, now + 3600_000)).toBe(first);
    expect(participantAvatarUrl("biz-1", "conv-1", "biz-1/instagram/c/1.jpg", "2026-11-23T12:00:00.000Z", now)).not.toBe(first);
    vi.unstubAllEnvs();
  });

  it("is null without a stored photo so the initials show", () => {
    expect(participantAvatarUrl("biz-1", "conv-1", null, "2026-11-16T12:00:00.000Z")).toBeNull();
  });
});
