import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transcribe: vi.fn(), respond: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: mocks.transcribe } };
    responses = { create: mocks.respond };
  },
  toFile: vi.fn(async () => new File(["test"], "business.webm")),
}));
import { analyzeAudio } from "./audio-provider";
import { audioFields } from "./audio-fields";
import { emptyAnswers } from "./model";
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
