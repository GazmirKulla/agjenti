import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { removePaymentCard, savePaymentCard } from "@/lib/billing/payments";
import { failure, noStore } from "../_respond";

/** Saves the signed-in person's card with POK. Only POK's card id and a masked label are kept. */
export async function POST(request: Request) {
  if (!permittedWrite(request)) return Response.json({ error: "Kërkesë e palejuar." }, { status: 403, headers: noStore });
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Hyr përsëri në llogari." }, { status: 401, headers: noStore });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Kërkesa nuk është e vlefshme." }, { status: 400, headers: noStore });
  }
  try {
    return Response.json(await savePaymentCard(user.id, payload), { headers: noStore });
  } catch (cause) {
    return failure(cause);
  }
}

export async function DELETE(request: Request) {
  if (!permittedWrite(request)) return Response.json({ error: "Kërkesë e palejuar." }, { status: 403, headers: noStore });
  const user = await getRequestUser(request);
  if (!user) return Response.json({ error: "Hyr përsëri në llogari." }, { status: 401, headers: noStore });
  try {
    await removePaymentCard(user.id);
    return Response.json({ removed: true }, { headers: noStore });
  } catch (cause) {
    return failure(cause);
  }
}
