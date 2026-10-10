import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  settings: vi.fn(),
  rpc: vi.fn(),
  analyze: vi.fn(),
  analyzeText: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/tenant/access", () => ({
  getSessionUser: mocks.user,
  listMemberships: mocks.access,
}));
vi.mock("@/lib/platform/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock("@/lib/onboarding/audio-provider", () => ({
  analyzeAudio: mocks.analyze,
  analyzeText: mocks.analyzeText,
}));
import { POST } from "./route";
import { POST as textPOST } from "../text/route";
import { emptyAnswers } from "@/lib/onboarding/model";
import { audioFields } from "@/lib/onboarding/audio-fields";
import { MAX_AUDIO_BYTES } from "@/lib/onboarding/audio-upload";
const id = "11111111-1111-4111-8111-111111111111";
function request(
  options: { mime?: string; size?: number; origin?: string } = {},
) {
  const bytes = new Uint8Array(options.size ?? 300);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  const form = new FormData();
  form.set(
    "audio",
    new File([bytes], "voice.webm", { type: options.mime ?? "audio/webm" }),
  );
  form.set("answers", JSON.stringify(emptyAnswers));
  return new Request("http://localhost:3003/api/onboarding/audio", {
    method: "POST",
    headers: { origin: options.origin ?? "http://localhost:3003" },
    body: form,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  mocks.user.mockResolvedValue({ id: "owner" });
  mocks.access.mockResolvedValue({ admin: false, businesses: [] });
  mocks.settings.mockResolvedValue({ onboarding_enabled: true });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === "claim_onboarding_audio" ? id : true,
    error: null,
  }));
  const query = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => void) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  mocks.from.mockReturnValue(query);
  const extraction = Object.fromEntries(
    audioFields.map((key) => [
      key,
      {
        value: key === "businessType" ? "services" : null,
        confidence: 0.95,
        evidence: null,
      },
    ]),
  );
  mocks.analyze.mockResolvedValue({
    transcript: "Kam një biznes shërbimesh.",
    extraction,
    responseId: "resp-test",
  });
  mocks.analyzeText.mockResolvedValue({
    transcript: "Shes vetëm një produkt fizik.",
    extraction: {
      ...extraction,
      businessType: { value: "retail", confidence: 0.95, evidence: "produkt fizik" },
      offeringTypes: { value: ["standard"], confidence: 0.95, evidence: "produkt fizik" },
      productCount: { value: "1", confidence: 0.95, evidence: "një produkt" },
      sellsProducts: { value: true, confidence: 0.95, evidence: "Shes" },
    },
    responseId: "resp-text",
  });
});

function textRequest(text = "Shes vetëm një produkt fizik.", origin = "http://localhost:3003") {
  return new Request("http://localhost:3003/api/onboarding/text", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({ text, answers: { ...emptyAnswers, name: "Dyqani", businessType: "retail" } }),
  });
}

describe("written onboarding analysis", () => {
  it("saves a separated offerings list instead of the original written paragraph", async () => {
    const analysis = await mocks.analyzeText();
    mocks.analyzeText.mockResolvedValue({
      ...analysis,
      extraction: { ...analysis.extraction, offeringsSummary: { value: ["Shampo", "Prerje flokësh"], confidence: 0.95, evidence: "shampo dhe prerje" } },
    });
    const response = await textPOST(new Request("http://localhost:3003/api/onboarding/text", {
      method: "POST",
      headers: { origin: "http://localhost:3003", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Ofroj shampo dhe prerje flokësh.", answers: { ...emptyAnswers, details: { offeringsSummary: ["Ofroj shampo dhe prerje flokësh."] } } }),
    }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.answers.details.offeringsSummary).toEqual(["Shampo", "Prerje flokësh"]);
    expect(mocks.rpc).toHaveBeenCalledWith("finish_onboarding_audio", expect.objectContaining({ p_answers: result.answers }));
  });
  it("extracts categorical fields from text and saves the prefilled review", async () => {
    const response = await textPOST(textRequest());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.answers).toMatchObject({
      name: "Dyqani",
      businessType: "retail",
      productCount: "1",
      offeringTypes: ["standard"],
      guidedOnboardingMode: "review",
      audioReview: { inputMode: "written" },
      details: { sellsProducts: true },
    });
    expect(mocks.analyzeText).toHaveBeenCalledWith("Shes vetëm një produkt fizik.", expect.objectContaining({ name: "Dyqani" }));
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("finish_onboarding_audio", expect.objectContaining({ p_answers: result.answers, p_response_id: "resp-text" }));
  });
  it("rejects empty and oversized text before analysis or writes", async () => {
    for (const text of ["   ", "a".repeat(12001), "a".repeat(128001)]) {
      expect((await textPOST(textRequest(text))).status).toBe(400);
    }
    expect(mocks.analyzeText).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("applies authentication, same-origin protection and shared rate limits to text", async () => {
    expect((await textPOST(textRequest(undefined, "https://other.test"))).status).toBe(403);
    mocks.user.mockResolvedValue(null);
    expect((await textPOST(textRequest())).status).toBe(401);
    mocks.user.mockResolvedValue({ id: "owner" });
    mocks.rpc.mockResolvedValue({ error: { message: "audio_daily_limit" } });
    expect((await textPOST(textRequest())).status).toBe(429);
    expect(mocks.analyzeText).not.toHaveBeenCalled();
  });
  it("returns a recoverable text error when extraction fails", async () => {
    mocks.analyzeText.mockRejectedValue(new Error("private provider detail"));
    const response = await textPOST(textRequest());
    expect(response.status).toBe(502);
    const result = await response.json();
    expect(result.error).toContain("Tekstet mbeten këtu");
    expect(result.error).not.toContain("private provider detail");
    expect(mocks.rpc).not.toHaveBeenCalledWith("finish_onboarding_audio", expect.anything());
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("audio onboarding boundary", () => {
  it("rejects unauthenticated users and foreign origins before any provider or DB write", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request({ origin: "https://other.test" }))).status).toBe(
      403,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("rejects members, admins and disabled onboarding", async () => {
    for (const access of [
      { admin: true, businesses: [] },
      { admin: false, businesses: [{ id: "existing" }] },
    ]) {
      mocks.access.mockResolvedValue(access);
      expect((await POST(request())).status).toBe(403);
    }
    mocks.access.mockResolvedValue({ admin: false, businesses: [] });
    mocks.settings.mockResolvedValue({ onboarding_enabled: false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("processes a turn and atomically stores the transcript and prefilled draft without creating a business", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.answers.businessType).toBe("services");
    expect(data.answers.details.sellsProducts).toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_onboarding_audio",
      expect.objectContaining({ p_user_id: "owner" }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "finish_onboarding_audio",
      expect.objectContaining({
        p_user_id: "owner",
        p_id: id,
        p_transcript: "Kam një biznes shërbimesh.",
      }),
    );
    expect(mocks.rpc.mock.calls.map((v) => v[0])).not.toContain(
      "complete_business_onboarding",
    );
  });
  it("rejects oversized and invalid media before spending on AI", async () => {
    expect((await POST(request({ mime: "text/html" }))).status).toBe(400);
    expect((await POST(request({ size: MAX_AUDIO_BYTES + 1 }))).status).toBe(
      400,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("enforces database-backed throttling and handles missing migration", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "audio_daily_limit" } });
    expect((await POST(request())).status).toBe(429);
    mocks.rpc.mockResolvedValue({ error: { message: "function missing" } });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("returns recoverable errors for missing credentials and provider failures", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("OPENAI_API_KEY", "test");
    mocks.analyze.mockRejectedValue(new Error("private provider detail"));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private provider detail",
    );
    expect(mocks.from).toHaveBeenCalledWith("onboarding_audio_attempts");
  });
  it("does not overwrite a draft edited in another tab", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "claim_onboarding_audio" ? id : false,
      error: null,
    }));
    expect((await POST(request())).status).toBe(409);
  });
});

describe('conversational onboarding boundary', () => {
  async function send(field='name') {
    const {POST: conversationPOST} = await import('../conversation/route');
    return conversationPOST(new Request(`http://localhost:3003/api/onboarding/conversation?field=${field}`, {
      method:'POST', headers:{origin:'http://localhost:3003','Content-Type':'application/json'},
      body:JSON.stringify({text:'Barriera',answers:emptyAnswers}),
    }));
  }
  it('requires the administrator to enable agent onboarding', async () => {
    expect((await send()).status).toBe(403);
    expect(mocks.analyzeText).not.toHaveBeenCalled();
  });
  it('passes the validated question as context and saves the result', async () => {
    mocks.settings.mockResolvedValue({onboarding_enabled:true,onboarding_mode:'agent'});
    expect((await send()).status).toBe(200);
    expect(mocks.analyzeText).toHaveBeenCalledWith('Barriera',expect.any(Object),undefined,'Si quhet biznesi yt?');
    expect(mocks.rpc).toHaveBeenCalledWith('finish_onboarding_audio',expect.objectContaining({p_user_id:'owner'}));
  });
  it('rejects unsupported question identifiers before running AI', async () => {
    mocks.settings.mockResolvedValue({onboarding_enabled:true,onboarding_mode:'agent'});
    expect((await send('forged')).status).toBe(400);
    expect(mocks.analyzeText).not.toHaveBeenCalled();
  });
});
