import { NextResponse } from "next/server";
import { reconcileOrder, submissionError, submissionResponse, submitConfirmedOrder } from "@/lib/orders/submission";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { isPlatformAdmin } from "@/lib/tenant/access";

type RouteContext = { params: Promise<{ id: string; conversationId: string }> };
async function actor(businessId: string) {
  const { data: { user } } = await (await createServerSupabase()).auth.getUser();
  if (!user) return null;
  if (await isPlatformAdmin(user.id)) return user.id;
  const { data, error } = await createServiceSupabase().from("business_users").select("user_id")
    .eq("user_id", user.id).eq("business_id", businessId).maybeSingle();
  return !error && data ? user.id : null;
}
async function handle(request: Request, context: RouteContext, reconcile: boolean) {
  try {
    const { id: businessId, conversationId } = await context.params;
    const userId = await actor(businessId);
    if (!userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const receipt = reconcile
      ? await reconcileOrder({ businessId, conversationId, userId, body: await request.json().catch(() => null) })
      : await submitConfirmedOrder({ businessId, conversationId, userId });
    const response = submissionResponse(receipt);
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    const response = submissionError(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
export async function POST(request: Request, context: RouteContext) { return handle(request, context, false); }
export async function PATCH(request: Request, context: RouteContext) { return handle(request, context, true); }
