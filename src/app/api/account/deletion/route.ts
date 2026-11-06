import { bearerToken, getRequestUser, permittedWrite } from "@/lib/auth/request";
import { scheduleAccountDeletion } from "@/lib/account/deletion";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!permittedWrite(request))
    return Response.json({ error: "Kërkesë e palejuar." }, { status: 403, headers });
  const user = await getRequestUser(request);
  if (!user)
    return Response.json({ error: "Hyr përsëri në llogari." }, { status: 401, headers });
  let body: { confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Kërkesa nuk është e vlefshme." }, { status: 400, headers });
  }
  if (body?.confirm !== true)
    return Response.json({ error: "Konfirmo fshirjen e llogarisë." }, { status: 400, headers });
  const token = request.headers.has("authorization")
    ? bearerToken(request)
    : (await (await createServerSupabase()).auth.getSession()).data.session?.access_token;
  const result = await scheduleAccountDeletion(user.id, token);
  if (!result.ok)
    return Response.json({ error: result.error }, { status: result.status, headers });
  return Response.json({ scheduled: true, purgeAfter: result.purgeAfter }, { headers });
}
