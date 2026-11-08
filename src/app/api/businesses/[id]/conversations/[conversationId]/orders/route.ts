import { NextResponse } from "next/server";
import { reconcileOrder, submissionError, submissionResponse, submitConfirmedOrder } from "@/lib/orders/submission";
import { requestUserId } from "@/lib/conversations/transport-access";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

type RouteContext = { params: Promise<{ id: string; conversationId: string }> };
/** Browser cookies or the native app's bearer token; then current membership. */
async function actor(request: Request, businessId: string) {
  const userId = await requestUserId(request);
  if (!userId) return null;
  if (await isPlatformAdmin(userId)) return userId;
  const { data, error } = await createServiceSupabase().from("business_users").select("user_id")
    .eq("user_id", userId).eq("business_id", businessId).maybeSingle();
  return !error && data ? userId : null;
}
async function handle(request: Request, context: RouteContext, reconcile: boolean) {
  try {
    const { id: businessId, conversationId } = await context.params;
    const userId = await actor(request, businessId);
    if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json().catch(() => null);
    const receipt = reconcile
      ? await reconcileOrder({ businessId, conversationId, userId, body })
      : await submitConfirmedOrder({ businessId, conversationId, userId, ...(typeof body?.actionId === "string" ? { actionId: body.actionId } : {}) });
    const response = submissionResponse(receipt);
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    const response = submissionError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
export async function POST(request: Request, context: RouteContext) { return handle(request, context, false); }
export async function PATCH(request: Request, context: RouteContext) { return handle(request, context, true); }
