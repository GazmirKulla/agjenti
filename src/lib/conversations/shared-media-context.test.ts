import { describe, expect, it, vi } from "vitest";
import type { NormalizedAttachment } from "@/lib/instagram/types";
import { sharedMediaTurnContext } from "./shared-media-context";

const reel = (mediaId: string | null, caption: string | null = null): NormalizedAttachment => ({
  kind: "share", externalMediaId: mediaId, sourceUrl: "https://www.instagram.com/reel/DYPUKXnM7Vk/", mimeType: null, caption,
  metadata: { instagramAttachmentType: "ig_reel" },
});

function fakeDb(rows: { id: string; name: string; external_id: string; business_id: string }[], fail = false) {
  const calls: { filters: [string, unknown][] }[] = [];
  return {
    calls,
    from(table: string) {
      expect(table).toBe("products");
      const filters: [string, unknown][] = [];
      calls.push({ filters });
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        in: (column: string, values: string[]) => {
          filters.push([column, values]);
          const business = filters.find(([c]) => c === "business_id")?.[1];
          return Promise.resolve(fail ? { data: null, error: { message: "down" } }
            : { data: rows.filter(row => row.business_id === business && values.includes(row.external_id)), error: null });
        },
      };
      return query;
    },
  };
}

describe("sharedMediaTurnContext", () => {
  it("resolves this business's own shared post to its product and pins it", async () => {
    const db = fakeDb([
      { id: "p1", name: "Fustan liri", external_id: "ig:18034567890123456", business_id: "b1" },
      { id: "other", name: "Of another business", external_id: "ig:18034567890123456", business_id: "b2" },
    ]);
    const context = await sharedMediaTurnContext(db as never, "b1", { current: [reel("18034567890123456", "Fustan liri, 3 ngjyra")] });
    expect(context?.productIds).toEqual(["p1"]);
    expect(context?.groundingHint).toBe("Fustan liri, 3 ngjyra");
    expect(JSON.parse(context!.attachmentContext).sharedInstagramMedia).toEqual([{ inThisTurn: true, type: "ig_reel", caption: "Fustan liri, 3 ngjyra",
      link: "https://www.instagram.com/reel/DYPUKXnM7Vk/", postOfThisBusiness: null, businessProduct: { id: "p1", name: "Fustan liri" } }]);
    expect(db.calls[0].filters).toContainEqual(["is_active", true]);
  });
  it("a reel shared just before the question still reaches the agent, marked as earlier", async () => {
    const context = await sharedMediaTurnContext(fakeDb([]) as never, "b1", { current: [], earlier: [[reel(null, "Koleksioni i ri")], null, [{ kind: "image", sourceUrl: "https://x.test/a.jpg" }]] });
    expect(JSON.parse(context!.attachmentContext).sharedInstagramMedia).toEqual([{ inThisTurn: false, type: "ig_reel", caption: "Koleksioni i ri", link: "https://www.instagram.com/reel/DYPUKXnM7Vk/", postOfThisBusiness: null, businessProduct: null }]);
    expect(context?.productIds).toEqual([]);
  });
  it("guesses no product when the post is someone else's or the lookup fails", async () => {
    expect((await sharedMediaTurnContext(fakeDb([]) as never, "b1", { current: [reel("18000000000000001")] }))?.productIds).toEqual([]);
    expect((await sharedMediaTurnContext(fakeDb([], true) as never, "b1", { current: [reel("18000000000000001", "x")] }))?.productIds).toEqual([]);
  });
  it("returns nothing when no post was shared", async () => {
    expect(await sharedMediaTurnContext(fakeDb([]) as never, "b1", { current: [], earlier: [] })).toBeNull();
  });
  it("a link-only reel of the business's own account takes its caption and media id from the business's posts", async () => {
    const db = fakeDb([{ id: "p1", name: "Puzzle druri", external_id: "ig:18034567890123456", business_id: "b1" }]);
    const ownPosts = vi.fn(async () => new Map([["https://www.instagram.com/reel/DYPUKXnM7Vk/", { id: "18034567890123456", caption: "Puzzle i Personalizuar Prej Druri" }]]));
    const context = await sharedMediaTurnContext(db as never, "b1", { current: [reel(null)], ownPosts });
    expect(ownPosts).toHaveBeenCalledWith(["https://www.instagram.com/reel/DYPUKXnM7Vk/"]);
    expect(JSON.parse(context!.attachmentContext).sharedInstagramMedia[0]).toMatchObject({
      caption: "Puzzle i Personalizuar Prej Druri", postOfThisBusiness: true, businessProduct: { id: "p1", name: "Puzzle druri" } });
    expect(context?.groundingHint).toBe("Puzzle i Personalizuar Prej Druri");
  });
  it("asks the business's posts only for what the channel left out, and survives a failed lookup", async () => {
    const ownPosts = vi.fn(async () => { throw new Error("graph down"); });
    const full = await sharedMediaTurnContext(fakeDb([]) as never, "b1", { current: [reel("18034567890123456", "Me caption")], ownPosts });
    expect(ownPosts).not.toHaveBeenCalled();
    expect(full?.groundingHint).toBe("Me caption");
    const failed = await sharedMediaTurnContext(fakeDb([]) as never, "b1", { current: [reel(null)], ownPosts });
    expect(JSON.parse(failed!.attachmentContext).sharedInstagramMedia[0]).toMatchObject({ caption: null, postOfThisBusiness: null, businessProduct: null });
  });
});
