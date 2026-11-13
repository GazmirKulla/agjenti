import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { isPaidPlan, startPlanPayment } from "@/lib/billing/payments";
import { failure, noStore } from "../_respond";

/** Starts one month of a plan for the signed-in person's own account, paid with their saved card. */
export async function POST(request: Request) {
  if (!permittedWrite(request)) return Response.json({ error: "Kërkesë e palejuar." }, { status: 403, headers: noStore });
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Hyr përsëri në llogari." }, { status: 401, headers: noStore });
  let body: { plan?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Kërkesa nuk është e vlefshme." }, { status: 400, headers: noStore });
  }
  if (!isPaidPlan(body?.plan)) return Response.json({ error: "Zgjidh një paketë me pagesë." }, { status: 400, headers: noStore });
  try {
    return Response.json(await startPlanPayment(user.id, body.plan), { headers: noStore });
  } catch (cause) {
    return failure(cause);
  }
}
