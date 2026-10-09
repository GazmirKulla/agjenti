import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { getAppSettings } from "@/lib/platform/settings";
import { createServiceSupabase } from "@/lib/supabase/service";
import { parseAnswers } from "@/lib/onboarding/model";
import { mergeExtraction } from "@/lib/onboarding/audio-model";
import { analyzeAudio, analyzeText } from "@/lib/onboarding/audio-provider";
import { readAudioForm } from "@/lib/onboarding/audio-upload";
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function handleOnboardingAnalysis(request: Request, source: "audio" | "text") {
  let attemptId: string | null = null;
  let userId: string | null = null;
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json({ error: "Kërkesa nuk është e vlefshme." }, 403);
    const user = await getSessionUser();
    if (!user) return json({ error: "Hyr përsëri për të vazhduar." }, 401);
    userId = user.id;
    const [access, settings] = await Promise.all([
      listMemberships(user.id),
      getAppSettings(),
    ]);
    if (
      access.admin ||
      access.businesses.length ||
      !settings.onboarding_enabled
    )
      return json(
        { error: "Kjo mënyrë është për hapësirat e reja të biznesit." },
        403,
      );
    if (!process.env.OPENAI_API_KEY?.trim())
      return json(
        {
          error:
            "Analiza me AI nuk është aktive për momentin. Mund të vazhdosh manualisht.",
        },
        503,
      );
    const input = source === "audio"
      ? await readAudioForm(request)
      : await readWrittenForm(request);
    const { raw } = input;
    const current = parseAnswers(raw, false, settings.onboarding_steps);
    const db = createServiceSupabase();
    const claim = await db.rpc("claim_onboarding_audio", {
      p_user_id: user.id,
      p_answers: current,
    });
    if (claim.error || typeof claim.data !== "string") {
      const message = claim.error?.message ?? "";
      const limited =
        message.includes("audio_daily_limit") || message.includes("audio_busy");
      return json(
        {
          error: message.includes("audio_busy")
            ? "Një analizë po kryhet. Prit pak dhe provo përsëri."
            : limited
              ? "Ke arritur kufirin e analizave për sot. Mund të vazhdosh manualisht."
              : "Analiza nuk është e disponueshme për momentin. Vazhdo manualisht ose provo më vonë.",
        },
        limited ? 429 : 503,
      );
    }
    attemptId = claim.data;
    const storeTranscript = async (transcript: string) => {
      const stored = await db
        .from("onboarding_audio_attempts")
        .update({ transcript })
        .eq("id", attemptId)
        .eq("user_id", user.id)
        .eq("status", "pending");
      if (stored.error) throw new Error("save_failed");
    };
    const result = "file" in input
      ? await analyzeAudio(input.file, current, storeTranscript)
      : await (async () => {
          await storeTranscript(input.text);
          return analyzeText(input.text, current);
        })();
    const answers = mergeExtraction(current, result.extraction, attemptId!, {
      replaceWrittenOfferings: source === "text",
    });
    const saved = await db.rpc("finish_onboarding_audio", {
      p_user_id: user.id,
      p_id: attemptId,
      p_transcript: result.transcript,
      p_extracted: result.extraction,
      p_answers: answers,
      p_response_id: result.responseId,
    });
    if (saved.error) throw new Error("save_failed");
    if (!saved.data)
      return json(
        {
          error:
            "Përgjigjet ndryshuan në një faqe tjetër. Rifresko faqen për të vazhduar; përgjigjet e analizës janë ruajtur.",
        },
        409,
      );
    return json({
      answers,
      transcript: result.transcript,
      analysisId: attemptId,
    });
  } catch (error) {
    if (attemptId && userId) {
      try {
        await createServiceSupabase()
          .from("onboarding_audio_attempts")
          .update({ status: "failed" })
          .eq("id", attemptId)
          .eq("user_id", userId)
          .eq("status", "pending");
      } catch {
        /* Keep the error recoverable; the lease expires. */
      }
    }
    const reason = error instanceof Error ? error.message : "";
    const invalid = [
      "invalid_upload",
      "invalid_audio_type",
      "invalid_answers",
      "audio_too_large",
      "invalid_text",
    ].includes(reason);
    return json(
      {
        error: source === "text"
          ? invalid
            ? "Shkruaj të paktën një përgjigje të vlefshme dhe provo përsëri."
            : "Nuk arritëm t’i analizonim përgjigjet. Tekstet mbeten këtu; provo përsëri."
          : invalid
          ? "Regjistrimi nuk është i vlefshëm ose është shumë i madh. Provo një audio më të shkurtër (deri 2 minuta)."
          : "Nuk arritëm ta analizonim audion. Regjistrimi yt mbetet këtu; provo përsëri ose plotëso manualisht.",
      },
      invalid ? 400 : 502,
    );
  }
}

async function readWrittenForm(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("invalid_text");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_text");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128000) {
        await reader.cancel();
        throw new Error("invalid_text");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let body;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new Error("invalid_text"); }
  if (!body || typeof body.text !== "string" || !body.text.trim() || body.text.length > 12000)
    throw new Error("invalid_text");
  return { text: body.text.trim(), raw: body.answers };
}
