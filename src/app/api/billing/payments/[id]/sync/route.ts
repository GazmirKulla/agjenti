import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { syncPlanPayment } from "@/lib/billing/payments";
import { failure, noStore } from "../../../_respond";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks the person's own payment with POK after the browser reports it finished. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!permittedWrite(request)) return Response.json({ error: "Kërkesë e palejuar." }, { status: 403, headers: noStore });
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Hyr përsëri në llogari." }, { status: 401, headers: noStore });
  const { id } = await params;
  if (!uuid.test(id)) return Response.json({ error: "Pagesa nuk u gjet." }, { status: 404, headers: noStore });
  try {
    return Response.json({ status: await syncPlanPayment(id, user.id) }, { headers: noStore });
  } catch (cause) {
    return failure(cause);
  }
}
