import type { SendInstagramResult } from "@/lib/instagram/send";
import type { MessagePart, PartObserver } from "@/lib/conversations/delivery-status";
import { isIsolatedExecution, refuseIsolatedEffect, assertBusinessEffectAllowed } from "@/lib/runtime/execution-context";

export const whatsappGraphVersion = () => process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v26.0";
class WhatsAppRejected extends Error {}
export async function whatsappGraph<T>(path: string, token: string, body?: unknown): Promise<T> {
  if (body !== undefined) assertBusinessEffectAllowed("whatsapp.write");
  if (isIsolatedExecution()) refuseIsolatedEffect("provider.http", "whatsapp");
  const response = await fetch(`https://graph.facebook.com/${whatsappGraphVersion()}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const message = "Kërkesa te WhatsApp dështoi. Kontrollo lejet dhe lidhjen në Meta.";
    if (response.status >= 400 && response.status < 500 && data.error) throw new WhatsAppRejected(message);
    throw new Error(message);
  }
  return data as T;
}
export async function sendWhatsAppText(params: { accountId: string; token: string; to: string; body: string; onPart?: PartObserver }): Promise<SendInstagramResult> {
  const body = params.body.trim();
  if (!body || body.length > 4096) return { ok: false, error: "Mesazhi duhet të ketë 1–4096 karaktere." };
  await params.onPart?.({ index: 0, body, status: "sending" }, 1);
  let part: MessagePart;
  try {
    const data = await whatsappGraph<{ messages?: { id: string }[] }>(`${params.accountId}/messages`, params.token, {
      messaging_product: "whatsapp", recipient_type: "individual", to: params.to, type: "text", text: { body, preview_url: false },
    });
    if (!data.messages?.[0]?.id) throw new Error("Missing receipt");
    part = { index: 0, body, status: "sent", messageId: data.messages[0].id };
  } catch (error) { part = { index: 0, body, status: error instanceof WhatsAppRejected ? "failed" : "uncertain", error: "Dërgimi në WhatsApp nuk u konfirmua. Kontrollo lidhjen dhe dritaren 24-orëshe." }; }
  await params.onPart?.(part, 1);
  return part.status === "sent" ? { ok: true, messageId: part.messageId, parts: [part] } : { ok: false, error: part.error!, parts: [part] };
}
