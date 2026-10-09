import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), respond: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: mocks.transcribe } };
    responses = { create: mocks.respond };
  },
  toFile: vi.fn(async () => new File(["test"], "business.webm")),
}));
import { analyzeAudio, analyzeText } from "./audio-provider";
import { audioFields } from "./audio-fields";
import { emptyAnswers } from "./model";
import { mergeExtraction } from "./audio-model";
import { offerMode } from "./rules";
const extraction = () =>
  Object.fromEntries(
    audioFields.map((key) => [
      key,
      {
        value: key === "businessType" ? "services" : null,
        confidence: key === "businessType" ? 0.9 : 0,
        evidence: key === "businessType" ? "vetëm shërbime" : null,
      },
    ]),
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test");
  mocks.transcribe.mockResolvedValue({ text: "Ne ofrojmë vetëm shërbime." });
  mocks.respond.mockResolvedValue({
    id: "resp",
    status: "completed",
    output_text: JSON.stringify(extraction()),
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("audio provider contract", () => {
  it("selects Products for an evidenced sale even when the provider omits the offer enum", async () => {
    const text = "shes produkt barriera te rikarikushme";
    const fields = extraction();
    fields.businessType = { value: null, confidence: 0, evidence: null };
    const output = { ...fields,
      sellsProducts: { value: true, confidence: 0.95, evidence: text },
      offeringsSummary: { value: ["Barriera të rikarikueshme"], confidence: 0.95, evidence: text },
    };
    mocks.respond.mockResolvedValue({ id: "resp", status: "completed", output_text: JSON.stringify(output) });
    const current = { ...emptyAnswers, name: "Dyqan", businessType: "retail" };
    const result = await analyzeText(text, current);
    const saved = mergeExtraction(current, result.extraction, "11111111-1111-4111-8111-111111111111", { replaceWrittenOfferings: true });
    expect(offerMode(saved.offeringTypes)).toBe("standard");
    expect(saved.details?.offeringsSummary).toEqual(["Barriera të rikarikueshme"]);
    expect(saved.audioReview?.confidence.offeringTypes).toBe(0.95);
  });
  it("analyzes written answers directly without invoking transcription", async () => {
    const text = "Ne ofrojmë vetëm shërbime.";
    const result = await analyzeText(text, emptyAnswers);
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(result.transcript).toBe(text);
    expect(result.extraction.businessType.value).toBe("services");
    const input = JSON.parse(mocks.respond.mock.calls[0][0].input);
    expect(input.newBusinessDescription).toBe(text);
  });
  it("persists transcription before structured extraction and derives schema from supported choices", async () => {
    const persisted = vi.fn(async () => {
      expect(mocks.respond).not.toHaveBeenCalled();
    });
    const result = await analyzeAudio(
      new File(["voice"], "voice.webm"),
      emptyAnswers,
      persisted,
    );
    expect(persisted).toHaveBeenCalledWith("Ne ofrojmë vetëm shërbime.");
    expect(result.extraction.businessType.value).toBe("services");
    expect(mocks.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        store: false,
        text: {
          format: expect.objectContaining({
            type: "json_schema",
            strict: true,
          }),
        },
      }),
    );
  });
  it("does not fabricate results for silence, refusals, truncation or malformed output", async () => {
    mocks.transcribe.mockResolvedValue({ text: "" });
    await expect(
      analyzeAudio(new File(["voice"], "voice.webm"), emptyAnswers),
    ).rejects.toThrow("empty_transcript");
    expect(mocks.respond).not.toHaveBeenCalled();
    mocks.transcribe.mockResolvedValue({ text: "vetëm shërbime" });
    for (const response of [
      { status: "incomplete", output_text: "{}" },
      { status: "completed", output_text: "" },
      { status: "completed", output_text: '{"bad":true}' },
    ]) {
      mocks.respond.mockResolvedValue(response);
      await expect(
        analyzeAudio(new File(["voice"], "voice.webm"), emptyAnswers),
      ).rejects.toThrow();
    }
  });
  it("stops before extraction if the transcript cannot be saved", async () => {
    await expect(
      analyzeAudio(
        new File(["voice"], "voice.webm"),
        emptyAnswers,
        async () => {
          throw new Error("db");
        },
      ),
    ).rejects.toThrow("db");
    expect(mocks.respond).not.toHaveBeenCalled();
  });
});
