import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto/tokens";
import { createServiceSupabase } from "@/lib/supabase/service";
import { overlaps, type Booking } from "./model";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
export function googleConfigured() {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REDIRECT_URI &&
    process.env.TOKEN_ENCRYPTION_KEY,
  );
}
function credentials() {
  if (!googleConfigured())
    throw new Error("Lidhja me Google Calendar nuk është konfiguruar.");
  return {
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
    redirect_uri: process.env.GOOGLE_CALENDAR_REDIRECT_URI!,
  };
}
export function googleAuthorizeUrl(state: string) {
  const { client_id, redirect_uri } = credentials();
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id, redirect_uri, response_type: "code", scope: GOOGLE_SCOPES.join(" "), state, access_type: "offline", prompt: "consent" })}`;
}
async function tokenRequest(body: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const data = await response.json();
  if (
    !response.ok ||
    typeof data.access_token !== "string" ||
    !Number.isFinite(data.expires_in)
  )
    throw new Error("Lidhja me Google ka skaduar. Lidhe përsëri.");
  return data as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
}
export async function exchangeGoogleCode(code: string) {
  const tokens = await tokenRequest({
    ...credentials(),
    code,
    grant_type: "authorization_code",
  });
  if (
    !tokens.refresh_token ||
    !GOOGLE_SCOPES.every((scope) => tokens.scope?.split(" ").includes(scope))
  )
    throw new Error("Google nuk dha të gjitha lejet. Provo përsëri.");
  return tokens;
}
type Connection = {
  id: string;
  business_id: string;
  calendar_id: string | null;
  calendar_name: string | null;
  connected: boolean;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  expires_at: string | null;
};
export async function googleConnection(
  businessId: string,
): Promise<Connection | null> {
  const { data, error } = await createServiceSupabase()
    .from("google_calendar_connections")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error("Nuk u ngarkua lidhja me kalendarin.");
  return data;
}
async function accessToken(connection: Connection) {
  if (!connection.connected || !connection.refresh_token_encrypted)
    throw new Error("Lidh përsëri Google Calendar.");
  if (
    connection.access_token_encrypted &&
    Date.parse(connection.expires_at ?? "") > Date.now() + 60000
  )
    return decryptSecret(connection.access_token_encrypted);
  const { client_id, client_secret } = credentials();
  const tokens = await tokenRequest({
    client_id,
    client_secret,
    grant_type: "refresh_token",
    refresh_token: decryptSecret(connection.refresh_token_encrypted),
  });
  const updated = await createServiceSupabase()
    .from("google_calendar_connections")
    .update({
      access_token_encrypted: encryptSecret(tokens.access_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", connection.business_id)
    .eq("id", connection.id)
    .eq("connected", true)
    .select("id")
    .single();
  if (updated.error || !updated.data)
    throw new Error("Lidhja ndryshoi. Provo përsëri.");
  return tokens.access_token;
}
async function googleFetch(
  connection: Connection,
  path: string,
  init: RequestInit = {},
  allowed: number[] = [],
) {
  const token = await accessToken(connection);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    },
  );
  if (allowed.includes(response.status)) return null;
  if (!response.ok)
    throw new Error(
      "Google Calendar nuk u përgjigj. Kontrollo lidhjen dhe provo përsëri.",
    );
  return response.status === 204 ? null : response.json();
}
export type GoogleCalendar = {
  id: string;
  summary: string;
  accessRole: string;
};
export async function writableCalendars(
  connection: Connection,
): Promise<GoogleCalendar[]> {
  const result: GoogleCalendar[] = [];
  let page = "";
  for (let i = 0; i < 10; i++) {
    const data = await googleFetch(
      connection,
      `users/me/calendarList?${new URLSearchParams({ minAccessRole: "writer", maxResults: "250", ...(page ? { pageToken: page } : {}) })}`,
    );
    result.push(
      ...(data.items ?? []).filter(
        (c: GoogleCalendar) =>
          c.accessRole === "owner" || c.accessRole === "writer",
      ),
    );
    if (!data.nextPageToken) return result;
    page = data.nextPageToken;
  }
  throw new Error("Lista e kalendarëve është shumë e madhe.");
}
export type BusyPeriod = { start: string; end: string };
export async function googleBusy(
  businessId: string,
  start: string,
  end: string,
  ignoreEvent?: string | null,
): Promise<BusyPeriod[]> {
  const connection = await googleConnection(businessId);
  if (!connection?.connected || !connection.calendar_id) return [];
  if (!ignoreEvent) {
    const data = await googleFetch(connection, "freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: start,
        timeMax: end,
        items: [{ id: connection.calendar_id }],
      }),
    });
    const calendar = data.calendars?.[connection.calendar_id];
    if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy))
      throw new Error("Nuk u verifikuan oraret në Google. Provo përsëri.");
    return calendar.busy;
  }
  const periods: BusyPeriod[] = [];
  let page = "";
  for (let i = 0; i < 10; i++) {
    const data = await googleFetch(
      connection,
      `calendars/${encodeURIComponent(connection.calendar_id)}/events?${new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", maxResults: "250", ...(page ? { pageToken: page } : {}) })}`,
    );
    for (const event of data.items ?? []) {
      if (
        event.id === ignoreEvent ||
        event.status === "cancelled" ||
        event.transparency === "transparent"
      )
        continue;
      // All-day events cover full calendar days, not UTC midnights.
      const tz = data.timeZone || "UTC";
      const { localInstant } = await import("./model");
      const begins =
        event.start?.dateTime ||
        (event.start?.date
          ? localInstant(event.start.date, "00:00", tz)
          : null);
      const finishes =
        event.end?.dateTime ||
        (event.end?.date ? localInstant(event.end.date, "00:00", tz) : null);
      if (!begins || !finishes)
        throw new Error("Nuk u verifikua një ngjarje në Google.");
      periods.push({ start: begins, end: finishes });
    }
    if (!data.nextPageToken) return periods;
    page = data.nextPageToken;
  }
  throw new Error("Ka shumë ngjarje për t’u verifikuar.");
}
/** Deterministic provider ID makes retries safe even when the HTTP result is lost. */
export function googleEventId(bookingId: string) {
  return `agjenti${bookingId.replaceAll("-", "")}`;
}
export async function syncBooking(businessId: string, bookingId: string) {
  const db = createServiceSupabase(),
    lease = randomUUID();
  const claimed = await db.rpc("claim_booking_sync", {
    p_business: businessId,
    p_booking: bookingId,
    p_lease: lease,
  });
  if (claimed.error) throw new Error("Sinkronizimi nuk filloi.");
  if (!claimed.data)
    throw new Error(
      "Sinkronizimi është në vazhdim ose rezervimi është tashmë i sinkronizuar.",
    );
  try {
    const result = await db
      .from("bookings")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", bookingId)
      .single();
    if (result.error) throw new Error();
    const booking = result.data as Booking & {
      google_connection_id: string | null;
    };
    const connection = await googleConnection(businessId);
    if (!connection?.connected || !connection.calendar_id)
      throw new Error("Lidh Google Calendar dhe zgjidh kalendarin.");
    if (
      booking.google_connection_id &&
      booking.google_connection_id !== connection.id
    )
      throw new Error("Lidhja ka ndryshuar. Rishiko rezervimin në Google.");
    const calendar = booking.google_calendar_id || connection.calendar_id;
    const eventId = booking.google_event_id || googleEventId(booking.id);
    const path = `calendars/${encodeURIComponent(calendar)}/events/${eventId}`;
    if (booking.status !== "confirmed") {
      if (booking.google_event_id)
        await googleFetch(connection, path, { method: "DELETE" }, [404, 410]);
    } else {
      // Exclude our deterministic event on retry; it may exist after a lost response.
      const busy = await googleBusy(
        businessId,
        booking.starts_at,
        booking.blocked_until,
        eventId,
      );
      if (
        busy.some((p) =>
          overlaps(booking.starts_at, booking.blocked_until, p.start, p.end),
        )
      )
        throw new Error("Ky orar është i zënë në Google.");
      const body = JSON.stringify({
        summary: `${booking.service_name} · ${booking.customer_name}`,
        description: booking.notes,
        start: { dateTime: booking.starts_at },
        end: { dateTime: booking.blocked_until },
        extendedProperties: { private: { agjentiBookingId: booking.id } },
      });
      const exists = await googleFetch(connection, path, {}, [404, 410]);
      if (exists)
        await googleFetch(connection, path, { method: "PATCH", body });
      else
        await googleFetch(
          connection,
          `calendars/${encodeURIComponent(calendar)}/events`,
          {
            method: "POST",
            body: JSON.stringify({ ...JSON.parse(body), id: eventId }),
          },
        );
    }
    const saved = await db
      .from("bookings")
      .update({
        sync_status: "synced",
        google_event_id: eventId,
        google_calendar_id: calendar,
        google_connection_id: connection.id,
        sync_lease: null,
        sync_lease_until: null,
      })
      .eq("business_id", businessId)
      .eq("id", bookingId)
      .eq("sync_lease", lease)
      .throwOnError();
    return saved;
  } catch {
    await db
      .from("bookings")
      .update({
        sync_status: "error",
        sync_lease: null,
        sync_lease_until: null,
      })
      .eq("business_id", businessId)
      .eq("id", bookingId)
      .eq("sync_lease", lease);
    throw new Error(
      "Rezervimi u ruajt në panel, por nuk u sinkronizua me Google. Riprovo sinkronizimin.",
    );
  }
}
