import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { createStarterWorkspace } from "@/lib/onboarding/starter";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  if (!permittedWrite(request))
    return Response.json({ error: "Kërkesë e palejuar." }, { status: 403, headers });
  const user = await getRequestUser(request);
  if (!user)
    return Response.json(
      { error: "Hyr përsëri në llogari." },
      { status: 401, headers },
    );
  try {
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json(
        { error: "Kontrollo të dhënat e biznesit." },
        { status: 400, headers },
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4000) {
          await reader.cancel();
          return Response.json(
            { error: "Kontrollo të dhënat e biznesit." },
            { status: 400, headers },
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const result = await createStarterWorkspace(user.id, body);
    if ("ok" in result) return Response.json({ ok: true, slug: result.slug, instagramUsername: result.instagramUsername, website: result.website }, { headers });
    return Response.json(
      { error: result.error },
      { status: result.status, headers },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "Kontrollo të dhënat e biznesit." },
        { status: 400, headers },
      );
    return Response.json(
      { error: "Hapësira nuk u krijua. Provo përsëri." },
      { status: 503, headers },
    );
  }
}
