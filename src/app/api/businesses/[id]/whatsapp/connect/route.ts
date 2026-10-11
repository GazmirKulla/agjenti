import { encryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getSessionUser, isPlatformAdmin } from "@/lib/tenant/access";
import { whatsappGraph, whatsappGraphVersion } from "@/lib/whatsapp/api";

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
  const input = await request.json().catch(() => null);
  if (!input || typeof input.code !== "string" || input.code.length > 4096 || !input.code ||
    typeof input.wabaId !== "string" || !/^\d{5,30}$/.test(input.wabaId) ||
    typeof input.phoneId !== "string" || !/^\d{5,30}$/.test(input.phoneId) ||
    typeof input.pin !== "string" || !/^\d{6}$/.test(input.pin)) return Response.json({ error: "Plotëso lidhjen dhe PIN-in me 6 shifra." }, { status: 400 });
  const appId = process.env.META_APP_ID?.trim(), secret = process.env.META_APP_SECRET?.trim();
  if (!appId || !secret) return Response.json({ error: "Lidhja WhatsApp nuk është konfiguruar ende." }, { status: 503 });
  try {
    const { data: existing, error: lookupError } = await db.from("whatsapp_connections").select("phone_number_id").eq("business_id", id).maybeSingle();
    if (lookupError) throw new Error("Nuk u lexua lidhja.");
    if (existing && existing.phone_number_id !== input.phoneId) return Response.json({ error: "Ky biznes ka një numër tjetër të lidhur. Ndryshimi i numrit kërkon ndihmën e administratorit." }, { status: 409 });
    const params = new URLSearchParams({ client_id: appId, client_secret: secret, code: input.code });
    const response = await fetch(`https://graph.facebook.com/${whatsappGraphVersion()}/oauth/access_token?${params}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const auth = await response.json();
    if (!response.ok || typeof auth.access_token !== "string") throw new Error("Autorizimi ka skaduar. Hape përsëri lidhjen me Meta.");
    const token = auth.access_token as string;
    // Confirm the submitted phone belongs to the WABA granted by this token.
    let after: string | undefined;
    let phone: { id: string; display_phone_number?: string; verified_name?: string } | undefined;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ fields: "id,display_phone_number,verified_name", limit: "100", ...(after ? { after } : {}) });
      const phones = await whatsappGraph<{ data: { id: string; display_phone_number?: string; verified_name?: string }[]; paging?: { next?: string; cursors?: { after?: string } } }>(`${input.wabaId}/phone_numbers?${query}`, token);
      phone = phones.data?.find(item => item.id === input.phoneId);
      if (phone || !phones.paging?.next || !phones.paging.cursors?.after) break;
      after = phones.paging.cursors.after;
    }
    if (!phone) throw new Error("Numri nuk i përket llogarisë WhatsApp të autorizuar.");
    const subscribed = await whatsappGraph<{ success?: boolean }>(`${input.wabaId}/subscribed_apps`, token, {});
    if (!subscribed.success) throw new Error("Nuk u aktivizua marrja e mesazheve.");
    const registered = await whatsappGraph<{ success?: boolean }>(`${input.phoneId}/register`, token, { messaging_product: "whatsapp", pin: input.pin });
    if (!registered.success) throw new Error("Numri nuk u aktivizua në WhatsApp.");
    const { error } = await db.from("whatsapp_connections").upsert({ business_id: id, phone_number_id: input.phoneId, waba_id: input.wabaId,
      display_phone_number: phone.display_phone_number ?? null, verified_name: phone.verified_name ?? null,
      access_token_ciphertext: encryptSecret(token), status: "connected", last_error: null, updated_at: new Date().toISOString(),
    }, { onConflict: "business_id" });
    if (error) throw new Error("Lidhja nuk u ruajt. Numri mund të jetë i lidhur me një biznes tjetër.");
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lidhja dështoi." }, { status: 400 });
  }
}
