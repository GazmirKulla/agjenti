export type ChannelId = "instagram" | "whatsapp";
export type ChannelConnection = { status: string; expiresAt?: string | null; lastError?: string | null };
export type ChannelActivity = { lastInboundAt: string | null; weekInbound: number | null };
export type ChannelHealth = {
  /** off: not connected · ok · warning: works but needs action soon · error: not receiving. */
  level: "off" | "ok" | "warning" | "error";
  /** Problems the owner should act on. */
  notes: string[];
  /** Plain information, not a problem (e.g. a quiet week). */
  info: string[];
};

const DAY = 86_400_000;

/** Effective status: a connected Instagram token past its expiry is expired. */
export function effectiveStatus(c: ChannelConnection | null, now = Date.now()) {
  if (!c) return "disconnected";
  if (c.status === "connected" && c.expiresAt && Date.parse(c.expiresAt) <= now) return "expired";
  return c.status;
}

export function channelHealth(channel: ChannelId, c: ChannelConnection | null, activity: ChannelActivity | null, now = Date.now()): ChannelHealth {
  const status = effectiveStatus(c, now);
  if (status === "disconnected") return { level: "off", notes: [], info: [] };
  if (status !== "connected") {
    return { level: "error", notes: [status === "expired"
      ? "Autorizimi skadoi. Mesazhet e reja nuk vijnë derisa ta rilidhësh."
      : "Lidhja kërkon rilidhje. Mesazhet e reja mund të mos vijnë."], info: [] };
  }
  const notes: string[] = [];
  let level: ChannelHealth["level"] = "ok";
  if (c?.lastError) {
    level = "warning";
    notes.push("Lidhja raportoi një gabim së fundi. Hap detajet për ta kontrolluar.");
  }
  if (channel === "instagram" && c?.expiresAt) {
    const days = Math.ceil((Date.parse(c.expiresAt) - now) / DAY);
    if (days <= 7) {
      level = "warning";
      notes.push(`Autorizimi skadon ${days <= 1 ? "brenda një dite" : `pas ${days} ditësh`}. Rilidhe që të mos ndalen mesazhet.`);
    }
  }
  const info = activity && activity.weekInbound === 0 ? ["Asnjë mesazh nga klientët në 7 ditët e fundit."] : [];
  return { level, notes, info };
}

/** True when a connected channel needs the owner: expired, failing or expiring soon. */
export function needsAttention(channel: ChannelId, c: ChannelConnection | null, now = Date.now()) {
  const level = channelHealth(channel, c, null, now).level;
  return level === "error" || level === "warning";
}

export function timeAgo(iso: string | null, now = Date.now()) {
  if (!iso) return null;
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "tani";
  if (minutes < 60) return `${minutes} min më parë`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} orë më parë`;
  return `${Math.round(hours / 24)} ditë më parë`;
}
