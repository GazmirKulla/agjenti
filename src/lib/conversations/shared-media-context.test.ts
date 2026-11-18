import { describe, expect, it } from "vitest";
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
      link: "https://www.instagram.com/reel/DYPUKXnM7Vk/", businessProduct: { id: "p1", name: "Fustan liri" } }]);
    expect(db.calls[0].filters).toContainEqual(["is_active", true]);
  });
  it("a reel shared just before the question still reaches the agent, marked as earlier", async () => {
    const context = await sharedMediaTurnContext(fakeDb([]) as never, "b1", { current: [], earlier: [[reel(null, "Koleksioni i ri")], null, [{ kind: "image", sourceUrl: "https://x.test/a.jpg" }]] });
    expect(JSON.parse(context!.attachmentContext).sharedInstagramMedia).toEqual([{ inThisTurn: false, type: "ig_reel", caption: "Koleksioni i ri", link: "https://www.instagram.com/reel/DYPUKXnM7Vk/", businessProduct: null }]);
    expect(context?.productIds).toEqual([]);
  });
  it("guesses no product when the post is someone else's or the lookup fails", async () => {
    expect((await sharedMediaTurnContext(fakeDb([]) as never, "b1", { current: [reel("18000000000000001")] }))?.productIds).toEqual([]);
    expect((await sharedMediaTurnContext(fakeDb([], true) as never, "b1", { current: [reel("18000000000000001", "x")] }))?.productIds).toEqual([]);
  });
  it("returns nothing when no post was shared", async () => {
    expect(await sharedMediaTurnContext(fakeDb([]) as never, "b1", { current: [], earlier: [] })).toBeNull();
  });
});
