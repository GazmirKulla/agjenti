import { createServiceSupabase } from '@/lib/supabase/service';
import { requireBusinessAccess } from '@/lib/tenant/access';
type Delivery = { id: string; event_id: string; token: string; attempts: number; receipt_id: string | null };
type ExpoReply = { status: string; id?: string; details?: { error?: string } };
async function expo(path: string, body: unknown) {
  const response = await fetch(`https://exp.host/--/api/v2/push/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('Push service unavailable');
  return response.json();
}
/** At-least-once delivery; notification IDs allow client deduplication. Never carries approval credentials. */
export async function deliverMobileNotifications() {
  const db = createServiceSupabase();
  const { data, error } = await db.rpc('claim_mobile_deliveries');
  if (error) throw Error('Notification queue unavailable');
  for (const delivery of (data ?? []) as Delivery[]) {
    try {
      const { data: event } = await db.from('mobile_notification_events').select('*').eq('id', delivery.event_id).single();
      const { data: device } = await db.from('mobile_devices').select('user_id').eq('token', delivery.token).maybeSingle();
      const { data: business } = event ? await db.from('businesses').select('slug').eq('id', event.business_id).maybeSingle() : { data: null };
      const access = event && business && device?.user_id === event.user_id ? await requireBusinessAccess(event.user_id, business.slug) : null;
      const { data: conversation } = event ? await db.from('assistant_conversations').select('id').eq('id', event.conversation_id).eq('owner_user_id', event.user_id).is('deleted_at', null).maybeSingle() : { data: null };
      if (!access || !conversation) { await db.from('mobile_notification_deliveries').update({ status: 'failed' }).eq('id', delivery.id); continue; }
      let reply: ExpoReply | undefined;
      if (delivery.receipt_id) {
        const receipts = await expo('getReceipts', { ids: [delivery.receipt_id] }); reply = receipts.data?.[delivery.receipt_id];
        if (!reply) { await db.from('mobile_notification_deliveries').update({ status: delivery.attempts >= 8 ? 'failed' : 'receipt', next_attempt: new Date(Date.now() + 15 * 60000).toISOString() }).eq('id', delivery.id); continue; }
      } else {
        const response = await expo('send', [{ to: delivery.token, title: 'Agjenti', body: event.kind === 'backend_outcome' ? 'Veprimi yt ka një rezultat të konfirmuar.' : event.kind === 'interrupted' ? 'Një kërkesë ka nevojë për kontroll.' : 'Asistenti ka një përgjigje për ty.', sound: 'default', channelId: 'assistant', data: { eventId: event.id, businessId: event.business_id, conversationId: event.conversation_id } }]); reply = response.data?.[0];
      }
      if (reply?.details?.error === 'DeviceNotRegistered') { await db.from('mobile_devices').delete().eq('token', delivery.token); continue; }
      if (reply?.status !== 'ok') throw Error('Push not accepted');
      if (!delivery.receipt_id && !reply.id) throw Error('Missing push receipt');
      await db.from('mobile_notification_deliveries').update({ status: delivery.receipt_id ? 'sent' : 'receipt', receipt_id: delivery.receipt_id || reply.id, next_attempt: new Date(Date.now() + 15 * 60000).toISOString() }).eq('id', delivery.id);
    } catch {
      await db.from('mobile_notification_deliveries').update({ status: delivery.attempts >= 8 ? 'failed' : delivery.receipt_id ? 'receipt' : 'pending', next_attempt: new Date(Date.now() + Math.min(3600, 30 * 2 ** delivery.attempts) * 1000).toISOString() }).eq('id', delivery.id);
    }
  }
}
