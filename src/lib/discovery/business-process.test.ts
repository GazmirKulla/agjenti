import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: m.create }; } }));
import { businessProcessContext, parseBusinessProcess, prepareBusinessProcess, processSources } from "./business-process";
import { emptyDraft } from "@/lib/business-intelligence/model";
const process = { name: "Marrja e materialeve PDF", summary: "Materialet merren nga website-i.", steps: [{ title: "Shkarko materialin", description: "Shkarko PDF-në nga website-i.", evidence: "Shkarko tani PDF", sourceRef: "instagram:filiz_studio_" }], unknowns: ["Mënyra e pagesës nuk është përcaktuar."] };
beforeEach(() => vi.clearAllMocks());
describe("source-backed business customer journey", () => {
  it("supports a published PDF journey without inventing payment or shipping steps", async () => {
    m.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ process }) });
    const result = await prepareBusinessProcess([{ reference: "instagram:filiz_studio_", text: "Fletë pune edukative\nShkarko tani PDF" }]);
    expect(result?.steps).toHaveLength(1);
    expect(result?.unknowns).toEqual(process.unknowns);
    expect(m.create.mock.calls[0][0].instructions).toContain("does not prove online payment");
    expect(businessProcessContext(result)).not.toContain("evidence");
  });
  it("rejects fabricated quotes and references even if the model returns a valid-shaped process", async () => {
    for (const step of [{ ...process.steps[0], evidence: "Pay by card" }, { ...process.steps[0], sourceRef: "https://foreign.test" }]) {
      m.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ process: { ...process, steps: [step] } }) });
      await expect(prepareBusinessProcess([{ reference: "instagram:filiz_studio_", text: "Shkarko tani PDF" }])).rejects.toThrow("unsupported_business_process");
    }
  });
  it("keeps bounded requests valid JSON and verifies only quotes actually submitted", async () => {
    const sources = Array.from({ length: 100 }, (_, i) => ({ reference: `source:${i}`, text: "\n".repeat(65000) }));
    sources.push({ reference: "instagram:filiz_studio_", text: "Shkarko tani PDF" });
    m.create.mockResolvedValue({ status: "completed", output_text: '{"process":null}' });
    await prepareBusinessProcess(sources);
    const input = m.create.mock.calls[0][0].input;
    expect(input.length).toBeLessThanOrEqual(85000);
    expect(JSON.parse(input).at(-1)).toEqual(sources.at(-1));
    m.create.mockResolvedValue({ status: "completed", output_text: JSON.stringify({ process: { ...process, steps: [{ ...process.steps[0], sourceRef: "source:99" }] } }) });
    await expect(prepareBusinessProcess(sources)).rejects.toThrow("unsupported_business_process");
  });
  it("an informational post can finish without a process and disabled processes are absent from replies", async () => {
    m.create.mockResolvedValue({ status: "completed", output_text: '{"process":null}' });
    expect(await prepareBusinessProcess([{ reference: "instagram:1", text: "Mirëmëngjes!" }])).toBeNull();
    expect(businessProcessContext({ ...parseBusinessProcess(process)!, enabled: false })).toBe("");
    expect(processSources(emptyDraft(), "", "instagram:1", parseBusinessProcess(process))).toEqual([{ reference: "instagram:filiz_studio_", text: "Shkarko tani PDF" }]);
  });
});
