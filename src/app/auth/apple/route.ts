import { startOAuth } from "@/lib/auth/oauth-start";

export async function GET(request: Request) {
  return startOAuth(request, "apple");
}
