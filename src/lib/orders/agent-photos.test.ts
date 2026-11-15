import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/service", () => ({ createServiceSupabase: () => ({}) }));
vi.mock("@/lib/integrations/zana", () => ({ submitExternalOrder: vi.fn() }));
import { pendingPhotoFields } from "@/lib/conversations/context";
import { readChosenFiles } from "./submission";

describe("photos staff choose for the agent's order", () => {
  it("reads the item photo and file fields of the catalog declaration", () => {
    expect(pendingPhotoFields({ fields: [
      { key: "character", label: "Personazhi", type: "text", appliesTo: "item", required: true },
      { key: "photo", label: "Fotoja", type: "photo", appliesTo: "item", required: true, max: 2 },
      { key: "logo", label: "Logo", type: "file", appliesTo: "order", required: false },
      { key: "extra", label: "Foto shtesë", type: "photo", required: false, min: 0, max: 99 },
    ] })).toEqual([
      { key: "photo", label: "Fotoja", type: "photo", required: true, max: 2 },
      { key: "extra", label: "Foto shtesë", type: "photo", required: false, min: 0 },
    ]);
    expect(pendingPhotoFields(null)).toEqual([]);
    expect(pendingPhotoFields({ fields: "x" })).toEqual([]);
  });
  it("accepts only the shape of chosen files; the database checks each path", () => {
    expect(readChosenFiles(undefined)).toBeNull();
    expect(readChosenFiles({ photo: ["b/c/x.jpg"] })).toEqual({ photo: ["b/c/x.jpg"] });
    for (const bad of [[], "x", { Photo: [] }, { photo: "x" }, { photo: [1] }, { photo: Array(11).fill("a") },
      Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`f${i}`, []]))])
      expect(readChosenFiles(bad)).toBe(false);
  });
});
