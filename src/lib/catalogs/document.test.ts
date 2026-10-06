import { it, expect, vi } from "vitest";
import { fetchPublicDocument } from "@/lib/products/import-url";
it("reads bounded public PDF content", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response("%PDF-1.7 content", {
      headers: { "content-type": "application/pdf" },
    }),
  );
  const result = await fetchPublicDocument("https://example.com/catalog.pdf", {
    fetch,
    resolveHost: async () => ["93.184.216.34"],
  });
  expect(result.pdf).toBe(true);
  expect(result.bytes.toString()).toContain("%PDF");
});
it("revalidates redirected hosts before fetching private documents", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private.pdf" },
    }),
  );
  await expect(
    fetchPublicDocument("https://example.com/catalog.pdf", {
      fetch,
      resolveHost: async () => ["93.184.216.34"],
    }),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("rejects oversized streamed or declared documents", async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response("small", {
      headers: {
        "content-length": "12000000",
        "content-type": "application/pdf",
      },
    }),
  );
  await expect(
    fetchPublicDocument("https://example.com/catalog.pdf", {
      fetch,
      resolveHost: async () => ["93.184.216.34"],
    }),
  ).rejects.toThrow("10 MB");
});
