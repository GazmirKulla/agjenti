import { handleOnboardingAnalysis } from "@/lib/onboarding/analysis-route";
export const maxDuration = 120;
export async function POST(request: Request) {
  return handleOnboardingAnalysis(
    request,
    request.headers.get("content-type")?.startsWith("multipart/form-data")
      ? "audio"
      : "text",
    true,
  );
}
