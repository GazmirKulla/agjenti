import { getSessionUser, listMemberships } from "@/lib/tenant/access";
import { getAppSettings } from "@/lib/platform/settings";
import { createServiceSupabase } from "@/lib/supabase/service";
import { parseAnswers } from "@/lib/onboarding/model";
import { mergeExtraction } from "@/lib/onboarding/audio-model";
import { analyzeAudio } from "@/lib/onboarding/audio-provider";
import { readAudioForm } from "@/lib/onboarding/audio-upload";
export const runtime = "nodejs";
export const maxDuration = 180;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
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
            "Analiza me audio nuk është aktive për momentin. Mund të vazhdosh manualisht.",
        },
        503,
      );
    const { file, raw } = await readAudioForm(request);
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
              : "Audioja nuk është e disponueshme për momentin. Vazhdo manualisht ose provo më vonë.",
        },
        limited ? 429 : 503,
      );
    }
    attemptId = claim.data;
    const result = await analyzeAudio(file, current, async (transcript) => {
      const stored = await db
        .from("onboarding_audio_attempts")
        .update({ transcript })
        .eq("id", attemptId)
        .eq("user_id", user.id)
        .eq("status", "pending");
      if (stored.error) throw new Error("save_failed");
    });
    const answers = mergeExtraction(current, result.extraction, attemptId!);
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
            "Përgjigjet ndryshuan në një faqe tjetër. Rifresko faqen për të vazhduar; transkripti është ruajtur.",
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
    ].includes(reason);
    return json(
      {
        error: invalid
          ? "Regjistrimi nuk është i vlefshëm ose është shumë i madh. Provo një audio më të shkurtër (deri 2 minuta)."
          : "Nuk arritëm ta analizonim audion. Regjistrimi yt mbetet këtu; provo përsëri ose plotëso manualisht.",
      },
      invalid ? 400 : 502,
    );
  }
}
