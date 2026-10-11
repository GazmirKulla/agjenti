import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Forbidden" }, { status: 403 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const db = createServiceSupabase();
  if (!await isPlatformAdmin(user.id)) {
    const { data } = await db.from("business_users").select("user_id").eq("business_id", id).eq("user_id", user.id).maybeSingle();
    if (!data) return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { error } = await db.from("whatsapp_connections").update({ status: "disconnected", access_token_ciphertext: "", updated_at: new Date().toISOString() }).eq("business_id", id);
  if (error) return Response.json({ error: "Shkëputja dështoi." }, { status: 500 });
  return Response.json({ ok: true });
}
