import { afterEach, beforeEach, expect, it, vi } from "vitest";
const page = vi.hoisted(() => vi.fn());
vi.mock("./public-page", () => ({ readPublicMaterial: page }));
import { resolveMaterials, linksInText } from "./materials";
import { sealAttachment } from "@/lib/agents/test-chat/attachments";
beforeEach(() => { vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64)); page.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it("accepts a signed attachment only for its owner and business", async () => {
  const file = sealAttachment({ name: "product.txt", kind: "document", text: "Material: pambuk" }, "u", "b");
  expect(await resolveMaterials([file.token], [], "u", "b")).toEqual([{ name: "product.txt", kind: "document", text: "Material: pambuk" }]);
  await expect(resolveMaterials([file.token], [], "u", "other")).rejects.toThrow("Skedari");
  await expect(resolveMaterials([file.token], [], "other", "b")).rejects.toThrow("Skedari");
});
it("rejects malformed materials and more than three before external calls", async () => {
  await expect(resolveMaterials([], Array(4).fill("https://example.com"), "u", "b")).rejects.toThrow();
  await expect(resolveMaterials("bad", [], "u", "b")).rejects.toThrow();
  await expect(resolveMaterials([], [42], "u", "b")).rejects.toThrow();
  expect(page).not.toHaveBeenCalled();
});
it("extracts bounded page data with source attribution and strips executable elements", async () => {
  page.mockResolvedValue({ url: "https://example.com/final", contentType: "text/html", body: "<style>hidden</style><script>bad()</script><h1>Produkt &amp; çmim</h1><p>" + "a".repeat(20000) + "</p>" });
  const [material] = await resolveMaterials([], ["https://example.com"], "u", "b");
  expect(material.url).toBe("https://example.com/final");
  expect(material.text).toHaveLength(16000);
  expect(material.text).toMatch(/^Produkt & çmim/);
  expect(material.text).not.toContain("bad()");
});
it("does not invent content for inaccessible, binary or empty pages", async () => {
  page.mockResolvedValueOnce({ error: "Faqja kërkon hyrje." }).mockResolvedValueOnce({url:"x",contentType:"application/pdf",body:"bytes"}).mockResolvedValueOnce({url:"x",contentType:"text/html",body:"<script>x</script>"});
  for (let i=0;i<3;i++) await expect(resolveMaterials([], ["https://example.com"], "u", "b")).rejects.toThrow();
});
it("extracts and deduplicates pasted links without sentence punctuation", () => {
  expect(linksInText("Lexo https://example.com/a. Pastaj https://example.com/a dhe https://example.com/b!")).toEqual(["https://example.com/a", "https://example.com/b"]);
});
