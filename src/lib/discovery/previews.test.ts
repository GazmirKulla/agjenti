import { describe, expect, it } from "vitest";
import { discoveryPreviews } from "./previews";

describe("onboarding scan previews", () => {
  it("exposes bounded captions and approved media without raw captures or token URLs", () => {
    const previews = discoveryPreviews("instagram", { text: "PRIVATE RAW CAPTURE", access_token: "SECRET", images: [
      { id: "one", url: "https://scontent.cdninstagram.com/photo.jpg?oe=123", caption: "Produkt " + "a".repeat(300) },
      { url: "https://scontent.cdninstagram.com/photo.jpg?access_token=SECRET", caption: "Postimi i dytë" },
      { url: "https://cdninstagram.com.attacker.test/photo.jpg", caption: "Postimi i tretë" },
      { url: "https://user:SECRET@scontent.fbcdn.net/photo.jpg", caption: "Postimi i katërt" },
    ] });
    expect(previews[0].imageUrl).toBe("https://scontent.cdninstagram.com/photo.jpg?oe=123");
    expect(previews[0].excerpt).toHaveLength(180);
    expect(previews.slice(1).every(item => item.imageUrl === null)).toBe(true);
    expect(JSON.stringify(previews)).not.toMatch(/SECRET|PRIVATE RAW CAPTURE/);
    expect(discoveryPreviews("instagram", { images: Array.from({ length: 100 }, () => ({ caption: "Postim" })) })).toHaveLength(25);
  });
  it("uses only bounded website page previews and safely handles older checkpoints", () => {
    expect(discoveryPreviews("website", { images: [{ url: "PRIVATE MEDIA" }], text: "PRIVATE RAW CAPTURE" })).toEqual([]);
    const result = discoveryPreviews("website", { previews: Array.from({ length: 12 }, () => ({ title: "Produkt ".repeat(50), excerpt: " Përshkrim\n".repeat(50), imageUrl: "PRIVATE MEDIA" })) });
    expect(result).toHaveLength(8);
    expect(result[0]).toMatchObject({ imageUrl: null });
    expect(result[0].title).toHaveLength(120);
    expect(result[0].excerpt).toHaveLength(180);
  });
});
