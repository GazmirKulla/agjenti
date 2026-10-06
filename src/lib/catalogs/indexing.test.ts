import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  response: vi.fn(),
  embedding: vi.fn(),
  rpc: vi.fn(),
  website: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    responses = { create: m.response };
    embeddings = { create: m.embedding };
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/business-intelligence/ingestion", () => ({
  extractWebsite: m.website,
}));
import { indexCatalog } from "./indexing";
import { emptyMetadata, type Catalog } from "./model";
const c: Catalog = {
  id: "doc",
  business_id: "tenant",
  title: "Pumps",
  source_type: "website",
  source_url: "https://example.test/catalog",
  storage_path: null,
  metadata: emptyMetadata,
  ai_summary: "",
  description: "",
  coverage: "",
  use_when: [],
  qualification_fields: [],
  active: false,
  index_status: "indexing",
  revision: 3,
  index_error: null,
  confirmed_at: null,
  share_token: "a".repeat(64),
  updated_at: "2026-10-06",
};
beforeEach(() => {
  vi.clearAllMocks();
  m.website.mockResolvedValue({
    text: "Industrial pumps. Capacity: 400 L/min.",
    note: "One page scanned",
  });
  m.response.mockResolvedValue({
    status: "completed",
    output_text: JSON.stringify({
      summary: "Pompa",
      coverage: "One section",
      metadata: { categories: ["pumps"] },
      sections: [
        {
          heading: "Pumps",
          text: "Capacity: 400 L/min.",
          page: null,
          keywords: ["pumps"],
        },
      ],
    }),
  });
  m.embedding.mockResolvedValue({
    data: [{ index: 0, embedding: Array(256).fill(0.1) }],
  });
  m.rpc.mockResolvedValue({ data: true });
});
it("indexes only grounded excerpts with embeddings in one tenant-scoped revision transaction", async () => {
  await indexCatalog(c);
  expect(m.rpc).toHaveBeenCalledWith(
    "finish_catalog_index",
    expect.objectContaining({
      p_business: "tenant",
      p_id: "doc",
      p_revision: 3,
      p_sections: [
        expect.objectContaining({
          text: "Capacity: 400 L/min.",
          page: null,
          embedding: Array(256).fill(0.1),
        }),
      ],
    }),
  );
  expect(m.response.mock.calls[0][0]).toMatchObject({ store: false });
});
it("rejects hallucinated text excerpts before persistence", async () => {
  m.response.mockResolvedValue({
    status: "completed",
    output_text: JSON.stringify({
      summary: "x",
      coverage: "x",
      sections: [
        {
          heading: "Pumps",
          text: "Certified for nuclear applications.",
          page: 1,
          keywords: [],
        },
      ],
    }),
  });
  await expect(indexCatalog(c)).rejects.toThrow("verifikueshme");
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects incomplete AI results and stale indexing revisions", async () => {
  m.response.mockResolvedValueOnce({ status: "incomplete", output_text: "{}" });
  await expect(indexCatalog(c)).rejects.toThrow("nuk përfundoi");
  m.rpc.mockResolvedValue({ data: false });
  await expect(indexCatalog(c)).rejects.toThrow("ndryshoi");
});
