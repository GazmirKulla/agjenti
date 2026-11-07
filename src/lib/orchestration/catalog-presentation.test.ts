import { expect, it } from "vitest";
import { digest } from "./definition";
import { initialSnapshot } from "./contracts";
import { catalogPresentationFromReply, renderCatalogSlots, visibleCatalogPresentation } from "./catalog-presentation";
const products = [{ id: "p1", name: "First" }, { id: "p2", name: "Second" }];
it("renders confirmed catalog slots in display order and ignores unverified ids", () => {
  const rendered = renderCatalogSlots("Look at [[product:p2]] then [[product:p1]] and [[product:missing]]", products, []);
  expect(rendered.reply).toContain("Second");
  expect(rendered.reply).toContain("First");
  expect(rendered.reply).toContain("[produkt i paverifikuar]");
  expect(rendered.presented?.items.map(item => item.id)).toEqual(["p2", "p1"]);
});
it("does not record a mixed product and service list as one ordinal namespace", () => {
  const rendered = renderCatalogSlots("[[product:p1]] [[service:s1]]", products, [{ id: "s1", name: "Cut" }]);
  expect(rendered.presented).toBeUndefined();
});
it("exposes live presentation only after the same reply was delivered", () => {
  const live = initialSnapshot("business", "conversation", "live");
  const reply = "Second then First";
  live.catalogPresentation = catalogPresentationFromReply("business", reply, { kind: "product", items: products }, 1);
  live.history = [{ role: "assistant", content: reply }];
  expect(visibleCatalogPresentation(live, 1, reply)?.entities.map(entity => entity.id)).toEqual(["p1", "p2"]);
  expect(visibleCatalogPresentation(live, 1, null)).toBeUndefined();
  expect(visibleCatalogPresentation({ ...live, history: [{ role: "assistant", content: "other" }] }, 1, reply)).toBeUndefined();
});
it("does not treat names as the presentation digest", () => {
  expect(catalogPresentationFromReply("business", "First", { kind: "product", items: products }, 1)?.replyDigest).toBe(digest("First"));
});
