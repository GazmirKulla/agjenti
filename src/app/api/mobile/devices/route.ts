import { getRequestUser, permittedWrite } from "@/lib/auth/request";
import { createServiceSupabase } from "@/lib/supabase/service";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!permittedWrite(request))
    return Response.json(
      { error: "Kërkesë e palejuar." },
      { status: 403, headers },
    );
  const user = await getRequestUser(request);
  if (!user)
    return Response.json(
      { error: "Hyr përsëri në llogari." },
      { status: 401, headers },
    );
  try {
    const reader = request.body?.getReader();
    if (!reader) throw Error("body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1000) {
          await reader.cancel();
          throw Error("size");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (
      !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(
        body.token,
      ) ||
      body.token.length > 250 ||
      !["register", "remove"].includes(body.mode)
    )
      throw Error("invalid");
    const db = createServiceSupabase();
    if (body.mode === "remove") {
      const { error } = await db
        .from("mobile_devices")
        .delete()
        .eq("token", body.token)
        .eq("user_id", user.id);
      if (error) throw error;
    } else {
      if (!["ios", "android"].includes(body.platform)) throw Error("platform");
      // Remove queued messages before reassigning a device to another account.
      const { error: clear } = await db
        .from("mobile_notification_deliveries")
        .delete()
        .eq("token", body.token);
      if (clear) throw clear;
      const { error } = await db
        .from("mobile_devices")
        .upsert({
          token: body.token,
          user_id: user.id,
          platform: body.platform,
          updated_at: new Date().toISOString(),
        });
      if (error) throw error;
    }
    return Response.json({ saved: true }, { headers });
  } catch {
    return Response.json(
      { error: "Njoftimet nuk u përditësuan. Provo përsëri." },
      { status: 400, headers },
    );
  }
}
