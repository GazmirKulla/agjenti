import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  normalize: vi.fn(),
  transcribe: vi.fn(),
  website: vi.fn(),
  instagram: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: m.user,
  requireBusinessAccess: m.access,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ from: m.from, rpc: m.rpc }),
}));
vi.mock("@/lib/business-intelligence/normalization", () => ({
  normalizeSource: m.normalize,
}));
vi.mock("@/lib/business-intelligence/transcription", () => ({
  transcribeAudio: m.transcribe,
}));
vi.mock("@/lib/business-intelligence/ingestion", () => ({
  extractWebsite: m.website,
  extractInstagram: m.instagram,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { POST } from "./route";
import { emptyDraft, parseEntities } from "@/lib/business-intelligence/model";
const request = (payload: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/business-intelligence?slug=test", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
let state: unknown;
beforeEach(() => {
  vi.clearAllMocks();
  state = null;
  m.user.mockResolvedValue({ id: "user" });
  m.access.mockResolvedValue({ business: { id: "business", name: "Test" } });
  m.from.mockImplementation(() => {
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn(() => q),
      update: vi.fn(() => q),
      maybeSingle: vi.fn(async () => ({ data: state })),
      single: vi.fn(async () => ({ data: { revision: 1 } })),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    return q;
  });
  m.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "intelligence_snapshot"
        ? {
            business: { name: "Test" },
            products: [],
            agents: [],
            knowledge: [],
          }
        : name === "claim_intelligence_source"
          ? "source-1"
          : 1,
  }));
});
describe("business intelligence boundary", () => {
  it("blocks unauthorized tenant access and cross-origin before source access", async () => {
    m.user.mockResolvedValue(null);
    expect((await POST(request({}))).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
    m.user.mockResolvedValue({ id: "u" });
    m.access.mockResolvedValue(null);
    expect((await POST(request({}))).status).toBe(403);
    expect((await POST(request({}, "https://evil.test"))).status).toBe(403);
  });
  it("creates a manual draft without AI or applying changes", async () => {
    const res = await POST(
      request({
        action: "ingest",
        revision: 0,
        source: "manual",
        target: "product",
        values: { name: "Puzzle", price: "25", currency: "EUR" },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(
      data.draft.entities.some(
        (e: { target: string }) => e.target === "product",
      ),
    ).toBe(true);
    expect(m.normalize).not.toHaveBeenCalled();
    expect(m.rpc.mock.calls.some((c) => c[0] === "apply_intelligence")).toBe(
      false,
    );
  });
  it("merges website extraction with source evidence and never applies automatically", async () => {
    m.website.mockResolvedValue({
      text: "Puzzle 25 EUR",
      reference: "https://shop.test",
      note: "1 page",
    });
    m.normalize.mockResolvedValue(
      parseEntities(
        [
          {
            target: "product",
            facts: [
              {
                field: "name",
                value: "Puzzle",
                evidence: "Puzzle",
                confidence: 0.9,
              },
            ],
          },
        ],
        "website",
        "https://shop.test",
        "Puzzle",
      ),
    );
    expect(
      (
        await POST(
          request({
            action: "ingest",
            revision: 0,
            source: "website",
            target: "product",
            text: "https://shop.test",
          }),
        )
      ).status,
    ).toBe(200);
    expect(m.normalize).toHaveBeenCalledWith(
      "Puzzle 25 EUR",
      "website",
      "https://shop.test",
      "product",
    );
  });
  it("requires explicit review and complete selected values", async () => {
    const entity = parseEntities(
      [{ target: "product", facts: [{ field: "name", value: "Puzzle" }] }],
      "manual",
      "",
      "",
    )[0];
    state = { revision: 1, data: { ...emptyDraft(), entities: [entity] } };
    expect(
      (
        await POST(
          request({ action: "apply", revision: 1, selected: [entity.id] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({
            action: "apply",
            revision: 1,
            confirmed: true,
            selected: [entity.id],
          }),
        )
      ).status,
    ).toBe(400);
    expect(m.rpc.mock.calls.some((c) => c[0] === "apply_intelligence")).toBe(
      false,
    );
  });
  it("applies reviewed data with server-owned entity IDs and provenance", async () => {
    const entity = parseEntities(
      [
        {
          target: "product",
          facts: [
            { field: "name", value: "Puzzle" },
            { field: "price", value: "25" },
            { field: "currency", value: "EUR" },
          ],
        },
      ],
      "manual",
      "",
      "",
    )[0];
    state = { revision: 1, data: { ...emptyDraft(), entities: [entity] } };
    expect(
      (
        await POST(
          request({
            action: "apply",
            revision: 1,
            confirmed: true,
            selected: [entity.id],
            edits: [],
          }),
        )
      ).status,
    ).toBe(200);
    const args = m.rpc.mock.calls.find(
      (c) => c[0] === "apply_intelligence",
    )![1];
    expect(
      args.p_entities[0].facts.every(
        (f: { confirmedByUser: boolean }) => f.confirmedByUser,
      ),
    ).toBe(true);
  });
  it("rejects stale tabs before expensive ingestion", async () => {
    state = { revision: 3, data: emptyDraft() };
    expect(
      (await POST(request({ action: "ingest", revision: 1 }))).status,
    ).toBe(400);
    expect(m.normalize).not.toHaveBeenCalled();
  });
});
