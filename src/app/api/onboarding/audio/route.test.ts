import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  settings: vi.fn(),
  rpc: vi.fn(),
  analyze: vi.fn(),
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
}));
import { POST } from "./route";
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
