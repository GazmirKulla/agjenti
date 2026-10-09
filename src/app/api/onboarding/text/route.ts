import { handleOnboardingAnalysis } from "@/lib/onboarding/analysis-route";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  return handleOnboardingAnalysis(request, "text");
}
